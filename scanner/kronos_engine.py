"""
Kronos AI Forecast Engine
Wraps the Kronos foundation model for OHLCV price forecasting.
Lazy-loads the model on first use, caches it as a module global.

Fetches historical OHLCV via yfinance, runs KronosPredictor with probabilistic
sampling (sample_count > 1), and returns forecast candles + confidence bands.
"""
import logging
import time
import asyncio
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger('tauric.kronos')

# Module-level globals (lazy loaded, cached)
_predictor = None
_load_lock = None  # asyncio.Lock created lazily on first call (needs running loop)

# Model configuration
MODEL_NAME = 'Kronos-small'
TOKENIZER_NAME = 'Kronos-Tokenizer-base'
MAX_CONTEXT = 512
HF_MODEL_ID = 'NeoQuasar/Kronos-small'
HF_TOKENIZER_ID = 'NeoQuasar/Kronos-Tokenizer-base'


async def _get_predictor():
    """Lazy-load and cache the Kronos predictor. Thread-safe via asyncio.Lock."""
    global _predictor, _load_lock

    if _predictor is not None:
        return _predictor

    # Create the lock on first use (needs a running event loop)
    if _load_lock is None:
        _load_lock = asyncio.Lock()

    async with _load_lock:
        # Double-check after acquiring lock (another coroutine may have loaded)
        if _predictor is not None:
            return _predictor

        def _load():
            try:
                import torch  # noqa: F401
            except ImportError as e:
                raise RuntimeError(
                    "PyTorch (torch) is not installed. "
                    "From tradesim/, run: npm run scanner:sync"
                ) from e
            from kronos_model import Kronos, KronosTokenizer, KronosPredictor
            logger.info('Loading Kronos tokenizer: %s', HF_TOKENIZER_ID)
            tokenizer = KronosTokenizer.from_pretrained(HF_TOKENIZER_ID)
            logger.info('Loading Kronos model: %s', HF_MODEL_ID)
            model = Kronos.from_pretrained(HF_MODEL_ID)
            logger.info('Creating KronosPredictor (device=cpu, max_context=%d)', MAX_CONTEXT)
            predictor = KronosPredictor(model, tokenizer, device='cpu', max_context=MAX_CONTEXT)
            return predictor

        # Model loading is CPU/IO heavy — run in a thread to not block the event loop
        _predictor = await asyncio.to_thread(_load)
        logger.info('Kronos model loaded and cached successfully')
        return _predictor


# ---------------------------------------------------------------------------
# Data fetching (shared Yahoo chart API + yfinance fallback)
# ---------------------------------------------------------------------------

from yahoo_data import fetch_ohlcv as _fetch_ohlcv, normalize_yahoo_symbol as _normalize_yahoo_symbol


# ---------------------------------------------------------------------------
# Forecasting
# ---------------------------------------------------------------------------

def _generate_forecast_blocking(
    predictor,
    df: pd.DataFrame,
    pred_len: int,
    sample_count: int = 5,
    interval: str = '1d',
) -> dict:
    """
    Run the Kronos prediction. This is a blocking CPU-heavy call.
    Returns a dict with forecast candles + confidence bands.

    Uses sample_count > 1 for probabilistic forecasting — we generate multiple
    sample paths and compute p10/p50/p90 percentiles from the close prices.

    Args:
        interval: '1d' for daily bars (future = business days) or '1h' for
                  hourly bars (future = hourly steps).
    """
    from kronos_model import KronosPredictor  # noqa: F401 (type hint)

    # Kronos needs timestamps as separate Series
    df = df.copy()
    df.index = pd.to_datetime(df.index)

    # Ensure tz-naive for the model
    if df.index.tz is not None:
        df.index = df.index.tz_localize(None)

    # Prepare the input columns in Kronos's expected order
    feature_cols = ['open', 'high', 'low', 'close', 'volume', 'amount']
    x_df = df[feature_cols].copy()

    # Historical timestamps
    x_timestamp = df.index.to_series()

    # Generate future timestamps for the prediction horizon
    last_date = df.index[-1]
    if interval == '1h':
        # Hourly bars — next 24 bars = 1 day forward
        y_timestamp = pd.Series(pd.date_range(
            start=last_date + pd.Timedelta(hours=1),
            periods=pred_len,
            freq='1h',
        ))
    else:
        # Daily bars — next N business days
        y_timestamp = pd.Series(pd.bdate_range(start=last_date + pd.Timedelta(days=1), periods=pred_len))

    # --- Generate multiple forecast paths for confidence bands ---
    # We call predict() multiple times with sample_count=1 to get independent paths,
    # OR once with sample_count=N (Kronos averages internally). For true percentile
    # bands we need individual paths, so we call N times with sample_count=1.
    paths = []
    for i in range(sample_count):
        pred_df = predictor.predict(
            df=x_df,
            x_timestamp=x_timestamp,
            y_timestamp=y_timestamp,
            pred_len=pred_len,
            T=1.0,
            top_k=0,
            top_p=0.9,
            sample_count=1,
            verbose=False,
        )
        paths.append(pred_df)

    # --- Compute median forecast + confidence bands ---
    # Stack all paths into a 3D array: [path, timestep, feature]
    stacked = np.stack([p[['open', 'high', 'low', 'close']].values for p in paths], axis=0)

    median_fc = np.median(stacked, axis=0)         # (timesteps, 4)
    p5_close = np.percentile(stacked[:, :, 3], 5, axis=0)    # wide band lower
    p10_close = np.percentile(stacked[:, :, 3], 10, axis=0)  # close is col index 3
    p25_close = np.percentile(stacked[:, :, 3], 25, axis=0)
    p75_close = np.percentile(stacked[:, :, 3], 75, axis=0)
    p90_close = np.percentile(stacked[:, :, 3], 90, axis=0)
    p95_close = np.percentile(stacked[:, :, 3], 95, axis=0)   # wide band upper

    # Build forecast candle list
    forecast_candles = []
    for i in range(pred_len):
        forecast_candles.append({
            'time': int(y_timestamp.iloc[i].timestamp()),
            'open': round(float(median_fc[i][0]), 2),
            'high': round(float(median_fc[i][1]), 2),
            'low': round(float(median_fc[i][2]), 2),
            'close': round(float(median_fc[i][3]), 2),
            'p5_close': round(float(p5_close[i]), 2),
            'p10_close': round(float(p10_close[i]), 2),
            'p25_close': round(float(p25_close[i]), 2),
            'p75_close': round(float(p75_close[i]), 2),
            'p90_close': round(float(p90_close[i]), 2),
            'p95_close': round(float(p95_close[i]), 2),
            'volume': round(float(paths[0].iloc[i].get('volume', 0)), 0) if 'volume' in paths[0].columns else 0,
        })

    # Historical candles (for the chart to show context)
    historical_candles = []
    for idx, row in df.iterrows():
        historical_candles.append({
            'time': int(idx.timestamp()),
            'open': round(float(row['open']), 2),
            'high': round(float(row['high']), 2),
            'low': round(float(row['low']), 2),
            'close': round(float(row['close']), 2),
            'volume': round(float(row['volume']), 0),
        })

    # --- Probabilistic metrics (Kronos-demo style) ---
    current_price = float(df['close'].iloc[-1])
    forecast_final = float(median_fc[-1][3])  # last predicted close (median)
    predicted_change_pct = ((forecast_final - current_price) / current_price) * 100

    # Upside Probability: fraction of paths where final close > current price
    all_final_prices = stacked[:, -1, 3]  # [path] → final close for each path
    upside_count = int(np.sum(all_final_prices > current_price))
    upside_probability = round((upside_count / len(paths)) * 100, 1)

    # Volatility Amplification: probability that forecast volatility > recent historical volatility
    # Historical: std of daily returns over last `pred_len` bars (guard NaN / tiny samples)
    recent_returns = df['close'].iloc[-max(pred_len, 5):].pct_change().dropna()
    hist_vol = float(recent_returns.std()) if len(recent_returns) >= 2 else float('nan')
    forecast_vols = []
    for p_idx in range(len(paths)):
        path_closes = stacked[p_idx, :, 3]
        if len(path_closes) < 2:
            forecast_vols.append(0.0)
            continue
        path_returns = np.diff(path_closes) / np.maximum(path_closes[:-1], 1e-9)
        forecast_vols.append(float(np.std(path_returns)))
    if not np.isfinite(hist_vol) or hist_vol <= 0:
        # Neutral when we cannot compare — avoid bogus 0% that tanks AI score UI
        volatility_amplification = 50.0
    else:
        vol_exceed_count = int(np.sum(np.array(forecast_vols) > hist_vol))
        volatility_amplification = round((vol_exceed_count / len(paths)) * 100, 1)

    # Sample paths for chart rendering (close prices only, per path)
    sample_paths = []
    for p_idx in range(len(paths)):
        path_data = []
        for i in range(pred_len):
            path_data.append({
                'time': int(y_timestamp.iloc[i].timestamp()),
                'value': round(float(stacked[p_idx, i, 3]), 2),
            })
        sample_paths.append(path_data)

    # --- Direction + confidence ---
    if predicted_change_pct > 1.0:
        direction = 'bullish'
    elif predicted_change_pct < -1.0:
        direction = 'bearish'
    else:
        direction = 'neutral'

    # Confidence: what fraction of paths agree on direction?
    final_prices = [float(p['close'].iloc[-1]) for p in paths]
    if direction == 'bullish':
        agreeing = sum(1 for p in final_prices if p > current_price)
    elif direction == 'bearish':
        agreeing = sum(1 for p in final_prices if p < current_price)
    else:
        agreeing = sum(1 for p in final_prices if abs(p - current_price) / current_price <= 0.01)
    confidence_pct = round((agreeing / len(paths)) * 100, 1)

    return {
        'forecast': forecast_candles,
        'historical': historical_candles,
        'sample_paths': sample_paths,
        'metadata': {
            'current_price': round(current_price, 2),
            'forecast_final_price': round(forecast_final, 2),
            'predicted_change_pct': round(predicted_change_pct, 2),
            'direction': direction,
            'confidence_pct': confidence_pct,
            'upside_probability': upside_probability,
            'volatility_amplification': volatility_amplification,
            'sample_count': sample_count,
            'lookback_used': len(df),
        },
    }


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def generate_forecast(
    symbol: str,
    horizon: int = 10,
    sample_count: int = 5,
    interval: str = '1d',
) -> dict:
    """
    Generate a Kronos AI forecast for the given symbol.

    Args:
        symbol: Yahoo Finance ticker (e.g. 'RELIANCE.NS')
        horizon: Number of future bars to predict (1-60)
        sample_count: Number of probabilistic sample paths (1-10)
        interval: '1d' for daily bars or '1h' for hourly bars

    Returns:
        Dict with 'historical', 'forecast', 'metadata' keys.

    Raises:
        ValueError: if data fetch fails or parameters are invalid
        RuntimeError: if model fails to load
    """
    # Validate params
    horizon = max(1, min(horizon, 60))
    sample_count = max(1, min(sample_count, 10))
    interval = '1h' if interval == '1h' else '1d'  # sanitize

    t0 = time.time()

    # Load model (lazy, cached)
    predictor = await _get_predictor()

    # Fetch data
    df = await asyncio.to_thread(_fetch_ohlcv, symbol, 400, interval)
    if df is None or len(df) < 30:
        raise ValueError(f'Insufficient historical data for {symbol} (need ≥30 bars, got {len(df) if df is not None else 0})')

    # Run forecast in a thread (CPU heavy)
    t_predict_start = time.time()
    result = await asyncio.to_thread(
        _generate_forecast_blocking,
        predictor,
        df,
        horizon,
        sample_count,
        interval,
    )

    result['metadata']['load_time_ms'] = 0  # model was already loaded
    result['metadata']['predict_time_ms'] = round((time.time() - t_predict_start) * 1000)
    result['metadata']['total_time_ms'] = round((time.time() - t0) * 1000)
    result['metadata']['model'] = MODEL_NAME
    result['metadata']['interval'] = interval
    result['symbol'] = symbol
    result['horizon'] = horizon
    result['interval'] = interval

    return result


async def get_model_status() -> dict:
    """Return whether the Kronos model is loaded in memory."""
    return {
        'loaded': _predictor is not None,
        'model_name': MODEL_NAME,
        'tokenizer': TOKENIZER_NAME,
    }

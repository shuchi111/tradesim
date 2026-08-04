"""
Tauric Research — 7 Screening Methods
Each method takes OHLCV data and returns True/False + details.
"""
import pandas as pd
import numpy as np
from indicators import sma, ema, rsi, macd, atr, supertrend, rolling_max
from config import SECTOR_INDICES


def _bool(x):
    """Convert numpy bool to native Python bool."""
    return bool(x)


def get_stock_summary(symbol: str, df: pd.DataFrame) -> dict:
    """Extract a technical summary from OHLCV data."""
    if len(df) < 60:
        return None

    close = df['close']
    high = df['high']
    low = df['low']
    volume = df['volume']

    current_close = close.iloc[-1]
    rsi_val = rsi(close, 14).iloc[-1]
    macd_line, signal_line, _ = macd(close)
    ema20 = ema(close, 20)
    ema50 = ema(close, 50)
    atr_val = atr(high, low, close, 14).iloc[-1]
    vol_avg_20 = volume.rolling(20).mean().iloc[-1]
    high_52w = high.tail(252).max() if len(high) >= 252 else high.max()
    low_52w = low.tail(252).min() if len(low) >= 252 else low.min()

    return {
        'symbol': symbol,
        'close': round(float(current_close), 2),
        'rsi': round(float(rsi_val), 1),
        'macd_signal': 'bullish' if _bool(macd_line.iloc[-1] > signal_line.iloc[-1]) else 'bearish',
        'ema_status': 'above' if _bool(ema20.iloc[-1] > ema50.iloc[-1]) else 'below',
        'vol_ratio': round(float(volume.iloc[-1] / vol_avg_20), 2) if vol_avg_20 > 0 else 1.0,
        'atr_pct': round(float(atr_val / current_close) * 100, 2) if current_close > 0 else 0,
        'high_52w': round(float(high_52w), 2),
        'low_52w': round(float(low_52w), 2),
        'ema20': round(float(ema20.iloc[-1]), 2),
        'ema50': round(float(ema50.iloc[-1]), 2),
        'vol_avg_20': round(float(vol_avg_20), 2) if vol_avg_20 == vol_avg_20 else 0,  # NaN check
    }


def method_m1_breakout_volume(df: pd.DataFrame, summary: dict) -> dict:
    """M1: 52-week high breakout with volume confirmation."""
    close = df['close']
    volume = df['volume']
    window = min(252, len(close))

    rolling_high = close.tail(window).shift(1).max()
    vol_avg = volume.rolling(20).mean().iloc[-1]

    breakout = close.iloc[-1] > rolling_high
    vol_confirm = volume.iloc[-1] > vol_avg * 1.5 if vol_avg > 0 else False

    triggered = _bool(breakout and vol_confirm)
    return {
        'method': 'M1',
        'name': 'Breakout + Volume',
        'triggered': triggered,
        'detail': f"Close ₹{float(close.iloc[-1]):.2f} vs 52W high ₹{float(rolling_high):.2f}, Vol {summary['vol_ratio']}x avg"
    }


def method_m2_supertrend_macd(df: pd.DataFrame, summary: dict) -> dict:
    """M2: Supertrend bullish + MACD crossover."""
    st = supertrend(df['high'], df['low'], df['close'], 7, 3)
    macd_line, signal_line, _ = macd(df['close'])

    st_bullish = st.iloc[-1] == 'bullish'
    macd_bullish = macd_line.iloc[-1] > signal_line.iloc[-1]
    # Fresh crossover this week (last 5 bars)
    recent_cross = any(
        macd_line.iloc[-1 - i] > signal_line.iloc[-1 - i] and
        macd_line.iloc[-2 - i] <= signal_line.iloc[-2 - i]
        for i in range(min(5, len(macd_line) - 2))
    )

    triggered = _bool(st_bullish and macd_bullish and recent_cross)
    return {
        'method': 'M2',
        'name': 'Supertrend + MACD',
        'triggered': triggered,
        'detail': f"ST: {st.iloc[-1]}, MACD: {'bullish' if macd_bullish else 'bearish'}, Cross: {'yes' if recent_cross else 'no'}"
    }


def method_m3_rsi_reversal(df: pd.DataFrame, summary: dict) -> dict:
    """M3: RSI exit from oversold with bullish candle."""
    rsi_series = rsi(df['close'], 14)
    rsi_prev = rsi_series.iloc[-2] if len(rsi_series) >= 2 else 50
    rsi_today = rsi_series.iloc[-1]

    bullish_candle = _bool(df['close'].iloc[-1] > df['open'].iloc[-1])
    triggered = _bool(rsi_prev < 30 and rsi_today > 35 and bullish_candle)

    return {
        'method': 'M3',
        'name': 'RSI Reversal',
        'triggered': triggered,
        'detail': f"RSI: {float(rsi_prev):.0f} → {float(rsi_today):.0f}, Candle: {'bullish' if bullish_candle else 'bearish'}"
    }


def method_m4_ema_crossover(df: pd.DataFrame, summary: dict) -> dict:
    """M4: Fresh 20/50 EMA bullish crossover."""
    ema20 = ema(df['close'], 20)
    ema50 = ema(df['close'], 50)

    today_bullish = ema20.iloc[-1] > ema50.iloc[-1]
    yesterday_bearish = ema20.iloc[-2] <= ema50.iloc[-2]
    vol_ok = df['volume'].iloc[-1] > df['volume'].rolling(20).mean().iloc[-1]

    triggered = _bool(today_bullish and yesterday_bearish and vol_ok)
    return {
        'method': 'M4',
        'name': 'EMA Crossover',
        'triggered': triggered,
        'detail': f"EMA20 {float(ema20.iloc[-1]):.2f} {'>' if today_bullish else '<'} EMA50 {float(ema50.iloc[-1]):.2f}, Cross: {'fresh' if yesterday_bearish else 'old'}"
    }


def method_m5_sector_momentum(symbol: str, sector_returns: dict) -> dict:
    """M5: Stock in top-2 momentum sectors."""
    if not sector_returns:
        return {'method': 'M5', 'name': 'Sector Momentum', 'triggered': False, 'detail': 'No sector data'}

    # Sort sectors by 5-day return
    sorted_sectors = sorted(sector_returns.items(), key=lambda x: x[1], reverse=True)
    top_2_sectors = set(s[0] for s in sorted_sectors[:2])

    # Check if symbol's sector is in top 2
    # For simplicity, we check if the symbol itself is in a high-momentum sector
    # In production, we'd map symbols to sectors
    symbol_sector = get_symbol_sector(symbol)
    triggered = _bool(symbol_sector in top_2_sectors) if symbol_sector else False

    return {
        'method': 'M5',
        'name': 'Sector Momentum',
        'triggered': triggered,
        'detail': f"Sector: {symbol_sector or 'unknown'}, Top sectors: {', '.join(s for s, _ in sorted_sectors[:2])}"
    }


def method_m6_engulfing(df: pd.DataFrame, summary: dict) -> dict:
    """M6: Bullish engulfing near 50EMA support."""
    open_ = df['open']
    close = df['close']
    low = df['low']
    ema50 = ema(close, 50)

    body_today = abs(close.iloc[-1] - open_.iloc[-1])
    body_yesterday = abs(close.iloc[-2] - open_.iloc[-2])

    engulfs = body_today > body_yesterday
    bullish = close.iloc[-1] > open_.iloc[-1]
    near_support = low.iloc[-1] > low.iloc[-2] * 0.99
    near_ema50 = abs(close.iloc[-1] - ema50.iloc[-1]) / ema50.iloc[-1] < 0.03 if ema50.iloc[-1] > 0 else False

    triggered = _bool(engulfs and bullish and near_support and near_ema50)
    return {
        'method': 'M6',
        'name': 'Bullish Engulfing',
        'triggered': triggered,
        'detail': f"Engulfs: {_bool(engulfs)}, Bullish: {_bool(bullish)}, Near EMA50: {_bool(near_ema50)}"
    }


def get_symbol_sector(symbol: str) -> str:
    """Map symbol to its sector index."""
    SECTOR_MAP = {
        'RELIANCE.NS': '^CNXENERGY', 'TCS.NS': '^CNXIT', 'HDFCBANK.NS': '^CNXBANK',
        'INFY.NS': '^CNXIT', 'ICICIBANK.NS': '^CNXBANK', 'SBIN.NS': '^CNXBANK',
        'AXISBANK.NS': '^CNXBANK', 'KOTAKBANK.NS': '^CNXBANK', 'ITC.NS': '^CNXFMCG',
        'LT.NS': '^CNXINFRA', 'HINDUNILVR.NS': '^CNXFMCG', 'BHARTIARTL.NS': '^CNXMEDIA',
        'MARUTI.NS': '^CNXAUTO', 'ASIANPAINT.NS': '^CNXFMCG', 'WIPRO.NS': '^CNXIT',
        'TATAMOTORS.NS': '^CNXAUTO', 'BAJFINANCE.NS': '^CNXFIN', 'TITAN.NS': '^CNXFMCG',
        'SUNPHARMA.NS': '^CNXPHARMA', 'HCLTECH.NS': '^CNXIT', 'ULTRACEMCO.NS': '^CNXINFRA',
        'NESTLEIND.NS': '^CNXFMCG', 'TECHM.NS': '^CNXIT', 'POWERGRID.NS': '^CNXENERGY',
        'NTPC.NS': '^CNXENERGY', 'ONGC.NS': '^CNXENERGY', 'COALINDIA.NS': '^CNXENERGY',
        'GRASIM.NS': '^CNXINFRA', 'JSWSTEEL.NS': '^CNXMETAL', 'TATASTEEL.NS': '^CNXMETAL',
        'BAJAJFINSV.NS': '^CNXFIN', 'DIVISLAB.NS': '^CNXPHARMA', 'CIPLA.NS': '^CNXPHARMA',
        'DRREDDY.NS': '^CNXPHARMA', 'EICHERMOT.NS': '^CNXAUTO', 'BRITANNIA.NS': '^CNXFMCG',
        'HEROMOTOCO.NS': '^CNXAUTO', 'BAJAJ-AUTO.NS': '^CNXAUTO', 'HINDALCO.NS': '^CNXMETAL',
        'IOC.NS': '^CNXENERGY', 'BPCL.NS': '^CNXENERGY', 'ADANIENT.NS': '^CNXINFRA',
        'ADANIPORTS.NS': '^CNXINFRA', 'HDFCLIFE.NS': '^CNXFIN', 'SBILIFE.NS': '^CNXFIN',
        'DMART.NS': '^CNXFMCG', 'ZOMATO.NS': '^CNXFMCG', 'PIDILITIND.NS': '^CNXINFRA',
        'SIEMENS.NS': '^CNXINFRA', 'ABB.NS': '^CNXINFRA', 'DLF.NS': '^CNXREALTY',
        'M&M.NS': '^CNXAUTO', 'HAL.NS': '^CNXINFRA', 'BEL.NS': '^CNXINFRA',
        'INDIGO.NS': '^CNXAUTO', 'VEDL.NS': '^CNXMETAL', 'NMDC.NS': '^CNXMETAL',
        'GAIL.NS': '^CNXENERGY', 'PFC.NS': '^CNXFIN', 'RECLTD.NS': '^CNXFIN',
        'CHOLAFIN.NS': '^CNXFIN', 'SHRIRAMFIN.NS': '^CNXFIN', 'CGPOWER.NS': '^CNXINFRA',
        'POLYCAB.NS': '^CNXINFRA', 'TVSMOTOR.NS': '^CNXAUTO',
    }
    return SECTOR_MAP.get(symbol, '')


def run_all_methods(symbol: str, df: pd.DataFrame, sector_returns: dict = None) -> dict:
    """Run all 6 rule-based methods on a stock. Returns summary + method results."""
    summary = get_stock_summary(symbol, df)
    if not summary:
        return None

    methods = [
        method_m1_breakout_volume(df, summary),
        method_m2_supertrend_macd(df, summary),
        method_m3_rsi_reversal(df, summary),
        method_m4_ema_crossover(df, summary),
        method_m5_sector_momentum(symbol, sector_returns or {}),
        method_m6_engulfing(df, summary),
    ]

    triggered = [m for m in methods if m['triggered']]

    return {
        'summary': summary,
        'methods': methods,
        'triggered_methods': [m['method'] for m in triggered],
        'triggered_count': len(triggered),
    }

"""
Unit tests for the Kronos forecast engine.
Tests the forecast logic with mocked KronosPredictor (no real model needed).
Run: cd /workspace/scanner && python3 -m pytest test_kronos.py -v
"""
import asyncio
import sys
import os
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

# Add scanner dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_mock_predictor():
    """Create a mock KronosPredictor that returns plausible forecast data."""
    predictor = MagicMock()
    predictor.device = 'cpu'
    predictor.max_context = 512

    def _predict(df, x_timestamp, y_timestamp, pred_len, T=1.0, top_k=0, top_p=0.9, sample_count=1, verbose=False):
        last_close = float(df['close'].iloc[-1])
        future_dates = pd.date_range(start=df.index[-1] + timedelta(days=1), periods=pred_len, freq='B')
        pred = pd.DataFrame(index=future_dates)
        # Simulate slight uptrend
        pred['open'] = last_close + np.random.uniform(-2, 2, pred_len)
        pred['high'] = pred['open'] + np.random.uniform(1, 5, pred_len)
        pred['low'] = pred['open'] - np.random.uniform(1, 5, pred_len)
        pred['close'] = last_close + np.linspace(0, 10, pred_len)  # uptrend
        pred['volume'] = np.random.randint(1000000, 5000000, pred_len)
        return pred

    predictor.predict = _predict
    return predictor


def _make_test_dataframe(rows=100):
    """Create a realistic OHLCV DataFrame mimicking yfinance output."""
    dates = pd.bdate_range(start='2024-01-01', periods=rows)
    close = 1000 + np.cumsum(np.random.uniform(-5, 5, rows))
    df = pd.DataFrame({
        'open': close + np.random.uniform(-2, 2, rows),
        'high': close + np.random.uniform(1, 8, rows),
        'low': close - np.random.uniform(1, 8, rows),
        'close': close,
        'volume': np.random.randint(1000000, 10000000, rows),
    }, index=dates)
    df['amount'] = df['volume'] * df['close']
    return df


# ---------------------------------------------------------------------------
# Tests — _generate_forecast_blocking
# ---------------------------------------------------------------------------

class TestGenerateForecast:
    """Test the core forecast logic with a mocked predictor."""

    def test_returns_forecast_list(self):
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=3)

        assert 'forecast' in result
        assert len(result['forecast']) == 5
        assert 'historical' in result
        assert len(result['historical']) == 100

    def test_forecast_candles_have_required_fields(self):
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=3, sample_count=3)
        candle = result['forecast'][0]

        required_fields = {'time', 'open', 'high', 'low', 'close', 'p10_close', 'p90_close', 'volume'}
        assert required_fields.issubset(set(candle.keys())), f"Missing fields: {required_fields - set(candle.keys())}"

    def test_confidence_bands_ordering(self):
        """p10_close should be <= p90_close."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=5)
        for candle in result['forecast']:
            assert candle['p10_close'] <= candle['p90_close'], \
                f"p10 ({candle['p10_close']}) > p90 ({candle['p90_close']})"

    def test_direction_bullish_when_uptrend(self):
        """A clearly upward forecast should produce 'bullish' direction."""
        from kronos_engine import _generate_forecast_blocking

        predictor = MagicMock()
        def _predict_uptrend(df, **kwargs):
            pred_len = kwargs['pred_len']
            last_close = float(df['close'].iloc[-1])
            future = pd.date_range(start=df.index[-1] + timedelta(days=1), periods=pred_len, freq='B')
            pred = pd.DataFrame(index=future)
            pred['open'] = last_close
            pred['high'] = last_close + 5
            pred['low'] = last_close
            pred['close'] = last_close + 20  # strong uptrend
            pred['volume'] = 1000000
            return pred
        predictor.predict = _predict_uptrend

        df = _make_test_dataframe(100)
        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=3)

        assert result['metadata']['direction'] == 'bullish'
        assert result['metadata']['predicted_change_pct'] > 1.0

    def test_direction_bearish_when_downtrend(self):
        """A clearly downward forecast should produce 'bearish' direction."""
        from kronos_engine import _generate_forecast_blocking

        predictor = MagicMock()
        def _predict_downtrend(df, **kwargs):
            pred_len = kwargs['pred_len']
            last_close = float(df['close'].iloc[-1])
            future = pd.date_range(start=df.index[-1] + timedelta(days=1), periods=pred_len, freq='B')
            pred = pd.DataFrame(index=future)
            pred['open'] = last_close
            pred['high'] = last_close
            pred['low'] = last_close - 5
            pred['close'] = last_close - 20  # strong downtrend
            pred['volume'] = 1000000
            return pred
        predictor.predict = _predict_downtrend

        df = _make_test_dataframe(100)
        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=3)

        assert result['metadata']['direction'] == 'bearish'
        assert result['metadata']['predicted_change_pct'] < -1.0

    def test_timestamps_are_unix_seconds(self):
        """Forecast timestamps should be valid Unix timestamps (seconds, not ms)."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=3, sample_count=2)
        for candle in result['forecast']:
            # Unix seconds for 2024+ should be ~1.7 billion; ms would be ~1.7 trillion
            assert 1_000_000_000 < candle['time'] < 3_000_000_000, \
                f"Timestamp {candle['time']} doesn't look like Unix seconds"

    def test_forecast_timestamps_continue_from_history(self):
        """First forecast timestamp should be after the last historical timestamp."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=2)
        last_hist_time = result['historical'][-1]['time']
        first_forecast_time = result['forecast'][0]['time']
        assert first_forecast_time > last_hist_time, \
            f"Forecast starts at {first_forecast_time} but history ends at {last_hist_time}"


# ---------------------------------------------------------------------------
# Tests — parameter validation
# ---------------------------------------------------------------------------

class TestParameterValidation:
    """Test that generate_forecast validates and clamps parameters."""

    @pytest.mark.asyncio
    async def test_horizon_clamped_to_max(self):
        """horizon=100 should be clamped to 60."""
        from kronos_engine import generate_forecast, _predictor

        with patch('kronos_engine._get_predictor', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = _make_mock_predictor()
            with patch('kronos_engine._fetch_ohlcv', return_value=_make_test_dataframe(100)):
                result = await generate_forecast('TEST.NS', horizon=100, sample_count=1)
                assert result['horizon'] == 60

    @pytest.mark.asyncio
    async def test_horizon_clamped_to_min(self):
        """horizon=0 should be clamped to 1."""
        from kronos_engine import generate_forecast

        with patch('kronos_engine._get_predictor', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = _make_mock_predictor()
            with patch('kronos_engine._fetch_ohlcv', return_value=_make_test_dataframe(100)):
                result = await generate_forecast('TEST.NS', horizon=0, sample_count=1)
                assert result['horizon'] == 1

    @pytest.mark.asyncio
    async def test_insufficient_data_raises_error(self):
        """Less than 30 bars of data should raise ValueError."""
        from kronos_engine import generate_forecast

        with patch('kronos_engine._get_predictor', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = _make_mock_predictor()
            with patch('kronos_engine._fetch_ohlcv', return_value=_make_test_dataframe(20)):
                with pytest.raises(ValueError, match='Insufficient historical data'):
                    await generate_forecast('TEST.NS', horizon=5, sample_count=1)


# ---------------------------------------------------------------------------
# Tests — _fetch_ohlcv
# ---------------------------------------------------------------------------

class TestFetchOhlcv:
    """Test the data fetching wrapper."""

    def test_returns_none_on_failure(self):
        """Invalid symbol should return None, not crash."""
        from kronos_engine import _fetch_ohlcv
        result = _fetch_ohlcv('TOTALLY_INVALID_SYMBOL_XYZ123', lookback=100)
        # Either None (error) or a DataFrame with 0 rows — both are acceptable failures
        assert result is None or len(result) == 0

    def test_adds_amount_column(self):
        """The 'amount' column should be present in the output."""
        import yfinance as yf
        from kronos_engine import _fetch_ohlcv

        # Mock yfinance to avoid network calls
        mock_hist = pd.DataFrame({
            'Open': [100, 101],
            'High': [105, 106],
            'Low': [99, 100],
            'Close': [104, 103],
            'Volume': [1000, 2000],
        }, index=pd.bdate_range('2024-01-01', periods=2))

        with patch.object(yf.Ticker, 'history', return_value=mock_hist):
            result = _fetch_ohlcv('TEST.NS', lookback=5)
            assert result is not None
            assert 'amount' in result.columns
            assert 'open' in result.columns  # lowercase
            assert 'close' in result.columns


# ---------------------------------------------------------------------------
# Tests — probabilistic metrics (Kronos-demo style)
# ---------------------------------------------------------------------------

class TestProbabilisticMetrics:
    """Test upside_probability, volatility_amplification, sample_paths."""

    def test_upside_probability_in_range(self):
        """upside_probability should be 0-100."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=5)
        up = result['metadata']['upside_probability']
        assert 0 <= up <= 100, f"upside_probability {up} out of range"

    def test_volatility_amplification_in_range(self):
        """volatility_amplification should be 0-100."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=5)
        vol = result['metadata']['volatility_amplification']
        assert 0 <= vol <= 100, f"volatility_amplification {vol} out of range"

    def test_sample_paths_returned(self):
        """sample_paths should be a list of paths, each with pred_len points."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=3)
        assert 'sample_paths' in result
        assert len(result['sample_paths']) == 3
        assert len(result['sample_paths'][0]) == 5
        # Each path point should have time and value
        pt = result['sample_paths'][0][0]
        assert 'time' in pt and 'value' in pt

    def test_wide_percentile_bands_present(self):
        """p5_close and p95_close should be in forecast candles."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=3, sample_count=5)
        c = result['forecast'][0]
        assert 'p5_close' in c, "Missing p5_close"
        assert 'p95_close' in c, "Missing p95_close"
        assert c['p5_close'] <= c['p95_close'], "p5 > p95"

    def test_band_ordering_all_percentiles(self):
        """p5 <= p10 <= p25 <= close(median) <= p75 <= p90 <= p95."""
        from kronos_engine import _generate_forecast_blocking
        predictor = _make_mock_predictor()
        df = _make_test_dataframe(100)

        result = _generate_forecast_blocking(predictor, df, pred_len=3, sample_count=5)
        for c in result['forecast']:
            assert c['p5_close'] <= c['p10_close'] <= c['p25_close']
            assert c['p75_close'] <= c['p90_close'] <= c['p95_close']

    def test_upside_probability_100_on_strong_uptrend(self):
        """When all paths end above current price, upside_probability should be 100."""
        from kronos_engine import _generate_forecast_blocking

        predictor = MagicMock()
        def _predict_uptrend(df, **kwargs):
            pred_len = kwargs['pred_len']
            last_close = float(df['close'].iloc[-1])
            future = pd.date_range(start=df.index[-1] + timedelta(days=1), periods=pred_len, freq='B')
            pred = pd.DataFrame(index=future)
            pred['open'] = last_close
            pred['high'] = last_close + 5
            pred['low'] = last_close
            pred['close'] = last_close + 50  # strong uptrend, all paths up
            pred['volume'] = 1000000
            return pred
        predictor.predict = _predict_uptrend

        df = _make_test_dataframe(100)
        result = _generate_forecast_blocking(predictor, df, pred_len=5, sample_count=5)
        assert result['metadata']['upside_probability'] == 100.0


# ---------------------------------------------------------------------------
# Run directly for quick manual testing
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    pytest.main([__file__, '-v'])

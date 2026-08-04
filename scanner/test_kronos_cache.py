"""
Tests for the Kronos forecast cache layer.
Run: cd /workspace/scanner && python3 -m pytest test_kronos_cache.py -v
"""
import json
import os
import sys
import tempfile
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def temp_db():
    """Use a temporary database for each test."""
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        db_path = f.name
    with patch('kronos_cache.DB_PATH', db_path):
        from kronos_cache import init_kronos_cache
        init_kronos_cache()
        yield db_path
    os.unlink(db_path)


def _make_mock_result(symbol='TEST.NS'):
    return {
        'symbol': symbol,
        'horizon': 10,
        'historical': [],
        'forecast': [],
        'sample_paths': [],
        'metadata': {
            'current_price': 1000,
            'forecast_final_price': 1050,
            'predicted_change_pct': 5.0,
            'direction': 'bullish',
            'confidence_pct': 80,
            'upside_probability': 75,
            'volatility_amplification': 40,
            'sample_count': 5,
            'lookback_used': 400,
        },
    }


class TestCacheInit:
    def test_init_creates_table(self, temp_db):
        import sqlite3
        conn = sqlite3.connect(temp_db)
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='kronos_forecasts'").fetchone()
        conn.close()
        assert tables is not None, "kronos_forecasts table not created"

    def test_init_is_idempotent(self, temp_db):
        from kronos_cache import init_kronos_cache
        init_kronos_cache()  # should not error on second call
        init_kronos_cache()  # third call also fine


class TestSaveAndGet:
    def test_save_and_retrieve(self, temp_db):
        from kronos_cache import save_forecast_to_cache, get_cached_forecast
        save_forecast_to_cache('RELIANCE.NS', _make_mock_result('RELIANCE.NS'))
        result = get_cached_forecast('RELIANCE.NS')
        assert result is not None
        assert result['symbol'] == 'RELIANCE.NS'
        assert result['direction'] == 'bullish'
        assert result['upside_probability'] == 75
        assert result['confidence_pct'] == 80

    def test_get_nonexistent_returns_none(self, temp_db):
        from kronos_cache import get_cached_forecast
        result = get_cached_forecast('NONEXISTENT.NS')
        assert result is None

    def test_full_forecast_stored_in_json(self, temp_db):
        from kronos_cache import save_forecast_to_cache, get_cached_forecast
        mock = _make_mock_result()
        mock['forecast'] = [{'time': 123, 'close': 100}]
        save_forecast_to_cache('TCS.NS', mock)
        result = get_cached_forecast('TCS.NS')
        assert result['full_forecast'] is not None
        assert result['full_forecast']['forecast'][0]['close'] == 100

    def test_latest_forecast_returned(self, temp_db):
        """When multiple forecasts exist, the most recent is returned."""
        from kronos_cache import save_forecast_to_cache, get_cached_forecast
        # Save first forecast
        r1 = _make_mock_result()
        r1['metadata']['confidence_pct'] = 50
        save_forecast_to_cache('INFY.NS', r1)
        # Save second forecast (slightly later by virtue of insertion order)
        import time
        time.sleep(0.1)
        r2 = _make_mock_result()
        r2['metadata']['confidence_pct'] = 90
        save_forecast_to_cache('INFY.NS', r2)
        result = get_cached_forecast('INFY.NS')
        assert result['confidence_pct'] == 90  # latest one


class TestGetAllCached:
    def test_returns_all_symbols(self, temp_db):
        from kronos_cache import save_forecast_to_cache, get_all_cached_forecasts
        save_forecast_to_cache('A.NS', _make_mock_result('A.NS'))
        save_forecast_to_cache('B.NS', _make_mock_result('B.NS'))
        save_forecast_to_cache('C.NS', _make_mock_result('C.NS'))
        all_fc = get_all_cached_forecasts()
        symbols = [f['symbol'] for f in all_fc]
        assert 'A.NS' in symbols
        assert 'B.NS' in symbols
        assert 'C.NS' in symbols


class TestCacheStatus:
    def test_returns_counts(self, temp_db):
        from kronos_cache import save_forecast_to_cache, get_cache_status
        save_forecast_to_cache('X.NS', _make_mock_result('X.NS'))
        save_forecast_to_cache('Y.NS', _make_mock_result('Y.NS'))
        status = get_cache_status()
        assert status['total_forecasts'] >= 2
        assert status['fresh_symbols'] >= 2
        assert status['latest_update'] is not None


class TestStaleCache:
    """Test that forecasts older than 36h are treated as stale."""

    def test_stale_forecast_returns_none(self, temp_db):
        """A forecast with created_at > 36h ago should return None."""
        import sqlite3
        from kronos_cache import save_forecast_to_cache, get_cached_forecast, DB_PATH
        save_forecast_to_cache('STALE.NS', _make_mock_result('STALE.NS'))

        # Manually backdate the timestamp to 48 hours ago
        conn = sqlite3.connect(temp_db)
        conn.execute(
            "UPDATE kronos_forecasts SET created_at = datetime('now', '-48 hours') WHERE symbol = 'STALE.NS'"
        )
        conn.commit()
        conn.close()

        result = get_cached_forecast('STALE.NS')
        assert result is None, f"Expected None for stale forecast, got {result}"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

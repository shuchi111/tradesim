"""
Kronos forecast cache layer.
Stores pre-computed daily forecasts in SQLite so the strategy engine can
read them instantly (no 18s model load per request).
"""
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Optional

from config import DB_PATH

logger = logging.getLogger('tauric.kronos_cache')

CACHE_STALE_HOURS = 36  # forecasts older than this are considered stale


def init_kronos_cache():
    """Create the kronos_forecasts table if it doesn't exist."""
    conn = sqlite3.connect(DB_PATH)
    try:
        # Enable WAL mode for better concurrent read/write performance
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS kronos_forecasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                direction TEXT NOT NULL,
                confidence_pct REAL NOT NULL,
                upside_probability REAL NOT NULL,
                volatility_amplification REAL NOT NULL,
                predicted_change_pct REAL NOT NULL,
                current_price REAL NOT NULL,
                forecast_final_price REAL NOT NULL,
                forecast_json TEXT NOT NULL,
                horizon INTEGER DEFAULT 10,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(symbol, created_at)
            );
            CREATE INDEX IF NOT EXISTS idx_kronos_symbol ON kronos_forecasts(symbol);
            CREATE INDEX IF NOT EXISTS idx_kronos_created ON kronos_forecasts(created_at);
        ''')
        conn.commit()
        logger.info('Kronos cache table initialized')
    finally:
        conn.close()


def save_forecast_to_cache(symbol: str, result: dict):
    """Store a Kronos forecast result in the cache. Upserts by symbol+created_at."""
    m = result.get('metadata', {})
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute('''
            INSERT OR REPLACE INTO kronos_forecasts
                (symbol, direction, confidence_pct, upside_probability,
                 volatility_amplification, predicted_change_pct, current_price,
                 forecast_final_price, forecast_json, horizon, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        ''', (
            symbol,
            m.get('direction', 'neutral'),
            m.get('confidence_pct', 0),
            m.get('upside_probability', 50),
            m.get('volatility_amplification', 50),
            m.get('predicted_change_pct', 0),
            m.get('current_price', 0),
            m.get('forecast_final_price', 0),
            json.dumps(result),
            result.get('horizon', 10),
        ))
        conn.commit()
    except sqlite3.Error as e:
        logger.error(f'Failed to cache forecast for {symbol}: {e}')
    finally:
        conn.close()


def get_cached_forecast(symbol: str) -> Optional[dict]:
    """
    Get the latest cached forecast for a symbol.
    Returns None if no forecast exists or it's stale (>36h old).
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            '''SELECT * FROM kronos_forecasts
               WHERE symbol = ? AND created_at > datetime('now', ?)
               ORDER BY created_at DESC LIMIT 1''',
            (symbol, f'-{CACHE_STALE_HOURS} hours')
        ).fetchone()

        if row is None:
            return None

        return {
            'symbol': row['symbol'],
            'direction': row['direction'],
            'confidence_pct': row['confidence_pct'],
            'upside_probability': row['upside_probability'],
            'volatility_amplification': row['volatility_amplification'],
            'predicted_change_pct': row['predicted_change_pct'],
            'current_price': row['current_price'],
            'forecast_final_price': row['forecast_final_price'],
            'horizon': row['horizon'],
            'created_at': row['created_at'],
            'full_forecast': json.loads(row['forecast_json']) if row['forecast_json'] else None,
        }
    finally:
        conn.close()


def get_all_cached_forecasts() -> list[dict]:
    """Get the latest cached forecast for all symbols (non-stale only)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            '''SELECT * FROM kronos_forecasts
               WHERE created_at > datetime('now', ?)
               GROUP BY symbol
               HAVING created_at = MAX(created_at)
               ORDER BY symbol''',
            (f'-{CACHE_STALE_HOURS} hours',)
        ).fetchall()

        results = []
        for row in rows:
            results.append({
                'symbol': row['symbol'],
                'direction': row['direction'],
                'confidence_pct': row['confidence_pct'],
                'upside_probability': row['upside_probability'],
                'volatility_amplification': row['volatility_amplification'],
                'predicted_change_pct': row['predicted_change_pct'],
                'current_price': row['current_price'],
                'forecast_final_price': row['forecast_final_price'],
                'horizon': row['horizon'],
                'created_at': row['created_at'],
            })
        return results
    finally:
        conn.close()


def get_cache_status() -> dict:
    """Return cache statistics."""
    conn = sqlite3.connect(DB_PATH)
    try:
        total = conn.execute('SELECT COUNT(*) FROM kronos_forecasts').fetchone()[0]
        fresh = conn.execute(
            "SELECT COUNT(DISTINCT symbol) FROM kronos_forecasts WHERE created_at > datetime('now', ?)",
            (f'-{CACHE_STALE_HOURS} hours',)
        ).fetchone()[0]
        latest = conn.execute(
            'SELECT MAX(created_at) FROM kronos_forecasts'
        ).fetchone()[0]
        return {
            'total_forecasts': total,
            'fresh_symbols': fresh,
            'latest_update': latest,
            'stale_after_hours': CACHE_STALE_HOURS,
        }
    finally:
        conn.close()

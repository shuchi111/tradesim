"""
Tauric Research — Database layer using SQLite
Tables: trade_log, scan_results
"""
import sqlite3
import json
from datetime import datetime, date
from typing import Optional
from config import DB_PATH


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS scan_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_date TEXT NOT NULL UNIQUE,
            regime TEXT,
            vix REAL,
            nifty_close REAL,
            fii_net REAL,
            picks_json TEXT,
            methods_fired_json TEXT,
            created_at TEXT DEFAULT (datetime('now')
            )
        );

        CREATE TABLE IF NOT EXISTS trade_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            method_id TEXT NOT NULL,
            entry_price REAL NOT NULL,
            exit_price REAL,
            return_pct REAL,
            entry_date TEXT NOT NULL,
            exit_date TEXT,
            status TEXT DEFAULT 'open',
            notes TEXT,
            scan_date TEXT,
            tags_json TEXT DEFAULT '[]',
            score REAL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_trade_method ON trade_log(method_id);
        CREATE INDEX IF NOT EXISTS idx_trade_status ON trade_log(status);
        CREATE INDEX IF NOT EXISTS idx_scan_date ON scan_results(scan_date);
    ''')
    conn.commit()
    conn.close()


def log_trade(symbol: str, method_id: str, entry_price: float,
              exit_price: Optional[float] = None, entry_date: str = None,
              notes: str = '', scan_date: str = None, tags: list = None,
              score: Optional[float] = None) -> dict:
    conn = get_db()
    return_pct = None
    status = 'open'
    exit_date = None

    if exit_price is not None and entry_price > 0:
        return_pct = ((exit_price - entry_price) / entry_price) * 100
        status = 'closed'
        exit_date = datetime.now().strftime('%Y-%m-%d')

    if entry_date is None:
        entry_date = datetime.now().strftime('%Y-%m-%d')

    cursor = conn.execute('''
        INSERT INTO trade_log (symbol, method_id, entry_price, exit_price, return_pct,
                               entry_date, exit_date, status, notes, scan_date, tags_json, score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (symbol, method_id, entry_price, exit_price, return_pct, entry_date,
          exit_date, status, notes, scan_date, json.dumps(tags or []), score))

    trade_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {
        'id': trade_id, 'symbol': symbol, 'method_id': method_id,
        'entry_price': entry_price, 'exit_price': exit_price,
        'return_pct': return_pct, 'entry_date': entry_date,
        'exit_date': exit_date, 'status': status, 'notes': notes,
        'tags': tags or [], 'score': score
    }


def update_trade(trade_id: int, exit_price: float = None, status: str = None,
                 notes: str = None, tags: list = None) -> dict:
    conn = get_db()
    trade = conn.execute('SELECT * FROM trade_log WHERE id = ?', (trade_id,)).fetchone()
    if not trade:
        conn.close()
        return None

    updates = []
    params = []

    if exit_price is not None:
        updates.append('exit_price = ?')
        params.append(exit_price)
        if trade['entry_price'] > 0:
            ret_pct = ((exit_price - trade['entry_price']) / trade['entry_price']) * 100
            updates.append('return_pct = ?')
            params.append(ret_pct)
        updates.append('exit_date = ?')
        params.append(datetime.now().strftime('%Y-%m-%d'))

    if status:
        updates.append('status = ?')
        params.append(status)

    if notes is not None:
        updates.append('notes = ?')
        params.append(notes)

    if tags is not None:
        updates.append('tags_json = ?')
        params.append(json.dumps(tags))

    params.append(trade_id)
    conn.execute(f'UPDATE trade_log SET {", ".join(updates)} WHERE id = ?', params)
    conn.commit()
    conn.close()

    return get_trade(trade_id)


def get_trade(trade_id: int) -> dict:
    conn = get_db()
    row = conn.execute('SELECT * FROM trade_log WHERE id = ?', (trade_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return dict(row) | {'tags': json.loads(row['tags_json'] or '[]')}


def get_all_trades(limit: int = 100) -> list:
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM trade_log ORDER BY created_at DESC LIMIT ?', (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) | {'tags': json.loads(r['tags_json'] or '[]')} for r in rows]


def get_method_performance() -> list:
    conn = get_db()
    rows = conn.execute('''
        SELECT method_id,
               COUNT(*) as total_trades,
               SUM(CASE WHEN return_pct > 0 THEN 1 ELSE 0 END) as wins,
               AVG(return_pct) as avg_return
        FROM trade_log
        WHERE status = 'closed'
        GROUP BY method_id
        ORDER BY method_id
    ''').fetchall()
    conn.close()

    result = []
    for row in rows:
        wr = (row['wins'] / row['total_trades'] * 100) if row['total_trades'] > 0 else 0
        avg_ret = row['avg_return'] or 0
        composite = (wr * 0.6) + (min(abs(avg_ret), 20) * (1 if avg_ret >= 0 else -1) * 0.4)
        result.append({
            'method_id': row['method_id'],
            'total_trades': row['total_trades'],
            'wins': row['wins'],
            'win_rate': round(wr, 1),
            'avg_return': round(avg_ret, 2),
            'composite_score': round(composite, 2),
        })
    return result


def save_scan_result(scan_date: str, regime: str, vix: float, nifty_close: float,
                     fii_net: float, picks: list, methods_fired: dict):
    conn = get_db()

    def _safe_default(o):
        if isinstance(o, bool):
            return str(o).lower()
        if isinstance(o, (int, float)):
            return o
        return str(o)

    picks_json = json.dumps(picks, default=_safe_default)
    methods_json = json.dumps(methods_fired, default=_safe_default)
    conn.execute('''
        INSERT INTO scan_results (scan_date, regime, vix, nifty_close, fii_net, picks_json, methods_fired_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scan_date) DO UPDATE SET
            regime=excluded.regime, vix=excluded.vix, nifty_close=excluded.nifty_close,
            fii_net=excluded.fii_net, picks_json=excluded.picks_json,
            methods_fired_json=excluded.methods_fired_json
    ''', (scan_date, regime, vix, nifty_close, fii_net, picks_json, methods_json))
    conn.commit()
    conn.close()


def get_scan_history(limit: int = 30) -> list:
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM scan_results ORDER BY scan_date DESC LIMIT ?', (limit,)
    ).fetchall()
    conn.close()
    result = []
    for row in rows:
        picks = json.loads(row['picks_json'] or '[]')
        methods = json.loads(row['methods_fired_json'] or '{}')
        result.append({
            'id': row['id'],
            'scan_date': row['scan_date'],
            'regime': row['regime'],
            'vix': row['vix'],
            'nifty_close': row['nifty_close'],
            'fii_net': row['fii_net'],
            'picks': picks,
            'methods_fired': methods,
        })
    return result


def get_latest_scan() -> dict:
    conn = get_db()
    row = conn.execute('SELECT * FROM scan_results ORDER BY scan_date DESC LIMIT 1').fetchone()
    conn.close()
    if not row:
        return None
    return {
        'id': row['id'],
        'scan_date': row['scan_date'],
        'regime': row['regime'],
        'vix': row['vix'],
        'nifty_close': row['nifty_close'],
        'fii_net': row['fii_net'],
        'picks': json.loads(row['picks_json'] or '[]'),
        'methods_fired': json.loads(row['methods_fired_json'] or '{}'),
    }

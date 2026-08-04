"""
Shared Yahoo Finance OHLCV helpers.

Uses the chart API first (same approach as Next.js market.ts / MoneyAttractor-compatible
behavior when yfinance is blocked), then falls back to yfinance.
"""
from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import unquote

import pandas as pd

logger = logging.getLogger('tauric.yahoo')

_YAHOO_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/120.0.0.0 Safari/537.36'
)

_SYMBOL_ALIASES = {
    'NIFTY50': '^NSEI',
    'NIFTY': '^NSEI',
    '%5ENSEI': '^NSEI',
    'NSEI': '^NSEI',
}

# Yahoo chart `range` values
_RANGE_BARS = {
    '5d': 10,
    '1mo': 40,
    '3mo': 100,
    '1y': 300,
    '2y': 600,
}


def normalize_yahoo_symbol(symbol: str) -> str:
    """Decode URL-encoded tickers and map app aliases to Yahoo symbols."""
    s = unquote(symbol or '').strip()
    key = s.upper()
    if key in _SYMBOL_ALIASES:
        return _SYMBOL_ALIASES[key]
    if s.startswith('%5E'):
        return '^' + s[3:]
    return s


def ohlcv_from_yahoo_chart(
    symbol: str,
    lookback: int = 400,
    interval: str = '1d',
    chart_range: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV via Yahoo Finance chart API.
    Returns DataFrame with lowercase open/high/low/close/volume/amount.
    """
    import httpx

    symbol = normalize_yahoo_symbol(symbol)
    interval = '1h' if interval == '1h' else '1d'

    if chart_range is None:
        if interval == '1h':
            chart_range = '2mo' if lookback > 100 else '1mo'
        else:
            chart_range = '2y' if lookback > 250 else '1y'

    encoded = symbol.replace('^', '%5E')
    url = (
        f'https://query1.finance.yahoo.com/v8/finance/chart/{encoded}'
        f'?interval={interval}&range={chart_range}'
    )

    try:
        with httpx.Client(timeout=30.0, headers={'User-Agent': _YAHOO_UA}) as client:
            res = client.get(url)
            res.raise_for_status()
            payload = res.json()
    except Exception as e:
        logger.error('Yahoo chart fetch failed for %s: %s', symbol, e)
        return None

    result = (payload.get('chart') or {}).get('result') or []
    if not result:
        return None
    result = result[0]
    timestamps = result.get('timestamp') or []
    quote = ((result.get('indicators') or {}).get('quote') or [{}])[0]
    if not timestamps or not quote:
        return None

    closes = quote.get('close') or []
    opens = quote.get('open') or []
    highs = quote.get('high') or []
    lows = quote.get('low') or []
    volumes = quote.get('volume') or []

    kept_ts = []
    kept_rows = []
    for i, ts in enumerate(timestamps):
        if i >= len(closes) or closes[i] is None:
            continue
        c = float(closes[i])
        o = float(opens[i]) if i < len(opens) and opens[i] is not None else c
        h = float(highs[i]) if i < len(highs) and highs[i] is not None else c
        l = float(lows[i]) if i < len(lows) and lows[i] is not None else c
        v = float(volumes[i]) if i < len(volumes) and volumes[i] is not None else 0.0
        kept_ts.append(ts)
        kept_rows.append({
            'open': o,
            'high': h,
            'low': l,
            'close': c,
            'volume': v,
            'amount': v * c,
        })

    if not kept_rows:
        return None

    hist = pd.DataFrame(kept_rows, index=pd.to_datetime(kept_ts, unit='s'))
    return hist.tail(lookback).copy()


def fetch_ohlcv(
    symbol: str,
    lookback: int = 400,
    interval: str = '1d',
    chart_range: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """
    Fetch historical OHLCV.
    Chart API first (reliable), then yfinance fallback (MoneyAttractor-style).
    """
    symbol = normalize_yahoo_symbol(symbol)
    interval = '1h' if interval == '1h' else '1d'

    hist = ohlcv_from_yahoo_chart(symbol, lookback, interval, chart_range=chart_range)
    if hist is not None and not hist.empty:
        return hist

    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        if chart_range:
            period = chart_range
        elif interval == '1h':
            period = '2mo'
        else:
            period = '2y' if lookback > 250 else '1y'
        hist = ticker.history(period=period, interval=interval)
        if hist.empty:
            return None
        hist.columns = [c.lower() for c in hist.columns]
        for col in ('open', 'high', 'low', 'close', 'volume'):
            if col not in hist.columns:
                hist[col] = 0.0
        if 'amount' not in hist.columns:
            hist['amount'] = hist['volume'] * hist['close']
        return hist.tail(lookback).copy()
    except Exception as e:
        logger.error('yfinance fetch failed for %s: %s', symbol, e)
        return None


def latest_quote(symbol: str, period: str = '5d') -> dict:
    """
    Latest close / prev_close / sma20 for market context.
    """
    lookback = _RANGE_BARS.get(period, 40)
    hist = fetch_ohlcv(symbol, lookback=max(lookback, 30), interval='1d', chart_range=period)
    if hist is None or hist.empty:
        # For short ranges like 5d, also try 1mo so SMA20 can be computed
        hist = fetch_ohlcv(symbol, lookback=40, interval='1d', chart_range='1mo')
    if hist is None or hist.empty:
        return {}

    close = float(hist['close'].iloc[-1])
    prev_close = float(hist['close'].iloc[-2]) if len(hist) >= 2 else close
    sma20_val = float(hist['close'].rolling(20).mean().iloc[-1]) if len(hist) >= 20 else close
    return {'close': close, 'prev_close': prev_close, 'sma20': sma20_val}

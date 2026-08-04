"""
Tauric Research — Market Context Provider
Fetches Nifty, VIX, FII/DII data and determines market regime.
"""
import httpx
import asyncio
from datetime import datetime

from yahoo_data import latest_quote


async def get_market_context() -> dict:
    """Fetch live market context: Nifty, VIX, FII/DII flows, regime."""
    try:
        # Fetch Nifty 50 and India VIX in parallel
        nifty_data, vix_data = await asyncio.gather(
            fetch_yahoo('^NSEI', '5d'),      # Nifty 50
            fetch_yahoo('^INDIAVIX', '5d'),   # India VIX
        )

        nifty_close = nifty_data.get('close', 0)
        nifty_prev = nifty_data.get('prev_close', 0)
        nifty_change_pct = ((nifty_close - nifty_prev) / nifty_prev * 100) if nifty_prev > 0 else 0
        nifty_sma20 = nifty_data.get('sma20', 0)

        vix_value = vix_data.get('close', 15)

        # FII/DII flows (best-effort — try stockedge or fallback)
        fii_net, dii_net = await fetch_fii_dii_flows()

        # Determine regime
        regime = determine_regime(vix_value, nifty_close, nifty_sma20, fii_net)

        return {
            'nifty_close': round(nifty_close, 2),
            'nifty_change_pct': round(nifty_change_pct, 2),
            'nifty_sma20': round(nifty_sma20, 2),
            'nifty_above_sma20': nifty_close > nifty_sma20,
            'vix': round(vix_value, 2),
            'fii_net': fii_net,
            'dii_net': dii_net,
            'regime': regime,
            'timestamp': datetime.now().isoformat(),
        }
    except Exception as e:
        # Fallback with safe defaults
        return {
            'nifty_close': 0,
            'nifty_change_pct': 0,
            'vix': 15,
            'fii_net': 0,
            'dii_net': 0,
            'regime': 'CAUTION',
            'error': str(e),
            'timestamp': datetime.now().isoformat(),
        }


async def fetch_yahoo(symbol: str, range: str = '5d') -> dict:
    """Fetch latest price data from Yahoo Finance (chart API + yfinance fallback)."""
    return await asyncio.to_thread(latest_quote, symbol, range)


async def fetch_fii_dii_flows() -> tuple:
    """
    Best-effort FII/DII flow data.
    Tries NSE data first; falls back to 0 if unavailable.
    """
    try:
        # Try to scrape NSE FII/DII data
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                'https://www.nseindia.com/api/fiidiiTradeReact',
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                fii_net = 0
                dii_net = 0
                for item in data.get('data', []):
                    if item.get('category') == 'FII':
                        fii_net = float(item.get('totalNet', 0))
                    elif item.get('category') == 'DII':
                        dii_net = float(item.get('totalNet', 0))
                return fii_net, dii_net
    except Exception:
        pass
    return 0, 0


def determine_regime(vix: float, nifty: float, nifty_sma20: float, fii_net: float) -> str:
    """Determine market regime: BULLISH / CAUTION / BEARISH."""
    # BEARISH: VIX > 20 OR Nifty below 200MA (use SMA20 as proxy)
    if vix > 20 or (nifty_sma20 > 0 and nifty < nifty_sma20 * 0.97):
        return 'BEARISH'

    # BULLISH: VIX < 15 AND Nifty above 20MA AND FII net positive
    if vix < 15 and (nifty_sma20 == 0 or nifty > nifty_sma20) and fii_net > 0:
        return 'BULLISH'

    # CAUTION: everything else
    return 'CAUTION'

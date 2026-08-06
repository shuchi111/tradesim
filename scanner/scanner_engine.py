"""
Tauric Research — Main Scanner Engine
Coordinates the 7-method scan pipeline.
"""
import asyncio
import logging
import pandas as pd
from datetime import datetime, date
from typing import List, Dict

from config import NIFTY500_UNIVERSE, MAX_PICKS, SECTOR_INDICES
from market_context import get_market_context, fetch_yahoo, determine_regime
from methods import run_all_methods, get_symbol_sector
from ai_scorer import score_stock_with_ai
from database import init_db, save_scan_result
from yahoo_data import fetch_ohlcv

logger = logging.getLogger('tauric.scanner')


async def fetch_stock_data(symbol: str) -> pd.DataFrame:
    """Fetch 60 days of daily OHLCV data for a stock."""
    return await asyncio.to_thread(
        fetch_ohlcv, symbol, 100, '1d', '3mo'
    )


async def get_sector_returns() -> dict:
    """Fetch 5-day returns for all sector indices."""
    async def fetch_sector(symbol):
        data = await fetch_yahoo(symbol, '5d')
        if data.get('close') and data.get('prev_close'):
            ret_5d = ((data['close'] - data['prev_close']) / data['prev_close']) * 100
            return symbol, ret_5d
        return symbol, 0

    results = await asyncio.gather(*[fetch_sector(s) for s in SECTOR_INDICES])
    return dict(results)


async def run_full_scan() -> dict:
    """
    Run the complete 7-method scan pipeline.
    Returns the scan result with top picks.
    """
    logger.info("Starting full scan...")
    init_db()

    # 1. Get market context
    context = await get_market_context()
    logger.info(f"Market regime: {context['regime']}, VIX: {context['vix']}")

    # 2. Get sector returns for M5
    sector_returns = await get_sector_returns()
    logger.info(f"Sector returns fetched for {len(sector_returns)} sectors")

    # 3. Scan universe
    candidates = []
    methods_fired = {}

    # Process in batches to avoid rate limits
    batch_size = 10
    universe = NIFTY500_UNIVERSE[:60]  # Top 60 for speed; full 500 in production

    for i in range(0, len(universe), batch_size):
        batch = universe[i:i + batch_size]
        tasks = [scan_single_stock(sym, sector_returns) for sym in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, Exception) or result is None:
                continue
            if result['triggered_count'] >= 1:
                candidates.append(result)
                for method_id in result['triggered_methods']:
                    methods_fired[method_id] = methods_fired.get(method_id, 0) + 1

        logger.info(f"Scanned {min(i + batch_size, len(universe))}/{len(universe)} stocks, {len(candidates)} candidates so far")

    logger.info(f"Scan complete: {len(candidates)} candidates from {len(universe)} stocks")

    # 4. AI scoring (M7) — required for ranked picks
    from config import ANTHROPIC_API_KEY
    if candidates and not (ANTHROPIC_API_KEY or '').strip():
        raise RuntimeError(
            'Daily scan found candidates but ANTHROPIC_API_KEY / LLM_API_KEY is missing. '
            'AI scoring (M7) is required — set the key in .env or GitHub Actions secrets.'
        )

    ai_picks = []
    ai_failures = 0
    for candidate in candidates:
        ai_result = await score_stock_with_ai(
            candidate['summary']['symbol'],
            candidate['summary'] | {'sector': get_symbol_sector(candidate['summary']['symbol'])},
            candidate['triggered_methods'],
            context['regime'],
            context['vix']
        )

        if ai_result:
            pick = {
                **ai_result,
                'summary': candidate['summary'],
                'method_details': candidate['methods'],
            }
            ai_picks.append(pick)
        else:
            ai_failures += 1

    if candidates and not ai_picks:
        raise RuntimeError(
            f'AI scoring failed for all {len(candidates)} candidates '
            f'({ai_failures} errors). Check LLM API key / base URL / model.'
        )

    if ai_failures:
        logger.warning(f'AI scoring failed for {ai_failures}/{len(candidates)} candidates')

    # 5. Sort by AI score and return top picks
    ai_picks.sort(key=lambda x: x.get('score', 0), reverse=True)
    top_picks = ai_picks[:MAX_PICKS]

    # 6. Save scan result
    scan_date = date.today().isoformat()
    save_scan_result(
        scan_date=scan_date,
        regime=context['regime'],
        vix=context['vix'],
        nifty_close=context['nifty_close'],
        fii_net=context['fii_net'],
        picks=top_picks,
        methods_fired=methods_fired
    )

    logger.info(f"Scan complete: {len(top_picks)} top picks")

    return {
        'scan_date': scan_date,
        'regime': context['regime'],
        'vix': context['vix'],
        'nifty_close': context['nifty_close'],
        'fii_net': context['fii_net'],
        'picks': top_picks,
        'methods_fired': methods_fired,
        'total_scanned': len(universe),
        'total_candidates': len(candidates),
        'timestamp': datetime.now().isoformat(),
    }


async def scan_single_stock(symbol: str, sector_returns: dict) -> dict | None:
    """Scan a single stock through all 6 rule-based methods."""
    df = await fetch_stock_data(symbol)
    if df is None or len(df) < 60:
        return None

    return run_all_methods(symbol, df, sector_returns)

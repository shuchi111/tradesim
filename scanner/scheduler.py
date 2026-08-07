"""
Tauric Research — Daily Scan Scheduler
Runs Kronos cache at 6:30 AM IST and full scan at 9:00 AM IST.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s: %(message)s')
logger = logging.getLogger('tauric.scheduler')

IST = timezone(timedelta(hours=5, minutes=30))


async def run_daily_scan():
    """Run the full scan and log results."""
    try:
        from scanner_engine import run_full_scan
        logger.info("Starting scheduled daily scan...")
        result = await run_full_scan()
        logger.info(
            f"Daily scan complete: {len(result['picks'])} picks, "
            f"regime={result['regime']}, VIX={result['vix']}"
        )
    except Exception as e:
        logger.error(f"Daily scan failed: {e}", exc_info=True)


async def run_daily_kronos_cache():
    """
    Pre-compute Kronos forecasts for key NIFTY50 stocks.
    Runs daily at 6:30 AM IST (1:00 UTC) — before market open at 9:15 AM.
    These cached forecasts power the strategy engine's Kronos signal.
    """
    try:
        from kronos_engine import generate_forecast
        from kronos_cache import save_forecast_to_cache, init_kronos_cache
        init_kronos_cache()

        # Nifty 50 index first, then key constituents (limit to 15 — each takes ~8-15s on CPU)
        symbols = [
            '^NSEI', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
            'HINDUNILVR.NS', 'ITC.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'KOTAKBANK.NS',
            'LT.NS', 'AXISBANK.NS', 'MARUTI.NS', 'SUNPHARMA.NS', 'TITAN.NS',
        ]
        logger.info(f"Starting daily Kronos cache refresh for {len(symbols)} symbols (5d + 10d)...")
        success, failed = 0, 0
        for sym in symbols:
            for horizon in (5, 10):
                try:
                    result = await generate_forecast(sym, horizon=horizon, sample_count=3)
                    save_forecast_to_cache(sym, result)
                    success += 1
                except Exception as e:
                    failed += 1
                    logger.error(f'Kronos cache refresh: {sym} {horizon}d failed: {e}')
        logger.info(f"Daily Kronos cache refresh complete: {success} OK, {failed} failed")
    except Exception as e:
        logger.error(f"Daily Kronos cache refresh failed: {e}", exc_info=True)


async def main():
    from database import init_db
    from kronos_cache import init_kronos_cache
    init_db()
    init_kronos_cache()

    scheduler = AsyncIOScheduler(timezone='Asia/Kolkata')
    scheduler.add_job(
        run_daily_scan, 'cron',
        hour=9, minute=0,  # 9:00 AM IST (morning scan)
        id='daily_scan',
        name='Tauric Daily Scan',
        replace_existing=True,
    )
    scheduler.add_job(
        run_daily_kronos_cache, 'cron',
        hour=6, minute=30,  # 6:30 AM IST — before market open
        id='daily_kronos_cache',
        name='Kronos Daily Forecast Cache',
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Tauric Scan Scheduler started — Kronos cache at 6:30 AM IST, daily scan at 9:00 AM IST")

    # Keep running
    while True:
        await asyncio.sleep(3600)


if __name__ == '__main__':
    asyncio.run(main())

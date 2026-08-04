"""
Tauric Research — FastAPI Server
Swing Trade Scanner API
"""
import os
import sys
import asyncio
import logging
from datetime import datetime
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s: %(message)s')
logger = logging.getLogger('tauric.api')

# Init database
from database import (
    init_db, log_trade, update_trade, get_all_trades,
    get_method_performance, save_scan_result, get_scan_history, get_latest_scan
)
from kronos_cache import init_kronos_cache
init_db()
init_kronos_cache()

from market_context import get_market_context
from scanner_engine import run_full_scan
from config import METHODS

app = FastAPI(title="Tauric Research Scanner", version="1.0.0", root_path="/scanner")

# CORS — allow the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Models ----
class TradeLogRequest(BaseModel):
    stock: str
    method: str
    entry_price: float
    exit_price: Optional[float] = None
    date: Optional[str] = None
    notes: str = ""
    tags: list = []
    score: Optional[float] = None
    scan_date: Optional[str] = None


class TradeUpdateRequest(BaseModel):
    exit_price: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list] = None


class PositionSizeRequest(BaseModel):
    portfolio: float
    entry: float
    stop_loss: float


# ---- Endpoints ----

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Tauric Research Scanner", "time": datetime.now().isoformat()}


@app.get("/api/methods")
async def get_methods():
    """Return the 7 method definitions."""
    return {"methods": METHODS}


@app.get("/api/context")
async def api_get_context():
    """Get live market context: Nifty, VIX, FII/DII, regime."""
    context = await get_market_context()
    return context


@app.get("/api/scan/run")
async def api_run_scan(background_tasks: BackgroundTasks):
    """Trigger the full 7-method scan. Returns top picks."""
    try:
        result = await run_full_scan()
        return result
    except Exception as e:
        logger.error(f"Scan failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/scan/latest")
async def api_get_latest_scan():
    """Get the most recent scan result."""
    scan = get_latest_scan()
    if not scan:
        return {"picks": [], "message": "No scan has been run yet. Click Run Scan."}
    return scan


@app.get("/api/scan/history")
async def api_get_history(limit: int = 30):
    """Get past scan results."""
    return {"history": get_scan_history(limit)}


@app.post("/api/trades")
async def api_log_trade(req: TradeLogRequest):
    """Log a trade."""
    trade = log_trade(
        symbol=req.stock, method_id=req.method, entry_price=req.entry_price,
        exit_price=req.exit_price, entry_date=req.date, notes=req.notes,
        tags=req.tags, score=req.score, scan_date=req.scan_date
    )
    return trade


@app.put("/api/trades/{trade_id}")
async def api_update_trade(trade_id: int, req: TradeUpdateRequest):
    """Update a trade (exit price, status, notes, tags)."""
    result = update_trade(trade_id, req.exit_price, req.status, req.notes, req.tags)
    if not result:
        raise HTTPException(status_code=404, detail="Trade not found")
    return result


@app.get("/api/trades")
async def api_get_trades(limit: int = 100):
    """Get all trades."""
    return {"trades": get_all_trades(limit)}


@app.get("/api/performance")
async def api_get_performance():
    """Get per-method performance stats."""
    perf = get_method_performance()

    # Fill in methods with no trades yet
    method_ids = {m['id'] for m in METHODS}
    existing = {p['method_id'] for p in perf}
    for mid in method_ids - existing:
        perf.append({
            'method_id': mid, 'total_trades': 0, 'wins': 0,
            'win_rate': 0, 'avg_return': 0, 'composite_score': 0
        })

    perf.sort(key=lambda x: x['method_id'])
    return {"performance": perf}


@app.post("/api/position-size")
async def api_position_size(req: PositionSizeRequest):
    """Calculate position size: (portfolio * 0.02) / (entry - stop_loss)."""
    risk_per_trade = req.portfolio * 0.02
    if req.entry <= req.stop_loss:
        raise HTTPException(status_code=400, detail="Entry must be above stop loss")
    risk_per_share = req.entry - req.stop_loss
    position_size = risk_per_trade / risk_per_share
    position_value = position_size * req.entry
    return {
        "position_size": round(position_size, 2),
        "position_value": round(position_value, 2),
        "risk_amount": round(risk_per_trade, 2),
        "risk_per_share": round(risk_per_share, 2),
        "risk_pct": round((risk_per_trade / req.portfolio) * 100, 2),
    }


# ---- TradingAgents (10-Agent LLM Trading Firm) ----

@app.get("/api/agents")
async def get_agents_info():
    """Return metadata for the 10+ TradingAgents."""
    from agent_engine import AGENTS_INFO
    return {"agents": AGENTS_INFO, "total": len(AGENTS_INFO)}


@app.post("/api/agents/analyze")
async def api_start_agent_analysis(ticker: str = "", body: dict = None):
    """Start a full 10-agent TradingAgents analysis in the background."""
    from agent_engine import start_agent_analysis

    # Support both query param and JSON body
    if body and 'ticker' in body:
        ticker = body['ticker']
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker parameter required")

    trade_date = body.get('trade_date') if body else None
    task_id = start_agent_analysis(ticker, trade_date)
    return {"task_id": task_id, "ticker": ticker, "status": "queued", "message": "Analysis started. Poll /api/agents/status/{task_id} for results."}


@app.get("/api/agents/analyze")
async def api_start_agent_analysis_get(ticker: str, trade_date: Optional[str] = None):
    """Start agent analysis via GET (for easy browser triggering)."""
    from agent_engine import start_agent_analysis
    task_id = start_agent_analysis(ticker, trade_date)
    return {"task_id": task_id, "ticker": ticker, "status": "queued", "message": "Analysis started. Poll /api/agents/status/{task_id} for results."}


@app.get("/api/agents/status/{task_id}")
async def api_agent_status(task_id: str):
    """Poll the status of a background agent analysis."""
    from agent_engine import get_task_status
    return get_task_status(task_id)


@app.get("/api/agents/history")
async def api_agent_history(limit: int = 20):
    """Get past agent analysis results."""
    from agent_engine import list_completed_analyses
    return {"history": list_completed_analyses(limit)}


@app.get("/api/agents/report/{ticker}/{trade_date}")
async def api_agent_report(ticker: str, trade_date: str):
    """Get a detailed agent report from disk (by ticker + date)."""
    from agent_engine import get_agent_reports_from_log
    data = get_agent_reports_from_log(ticker, trade_date)
    if not data:
        raise HTTPException(status_code=404, detail="No analysis found for this ticker/date")
    return data


# ---- Kronos AI Forecast ----

@app.get("/api/forecast/status")
async def api_forecast_status():
    """Check if the Kronos model is loaded in memory."""
    from kronos_engine import get_model_status
    return await get_model_status()


@app.get("/api/forecast/{symbol}")
async def api_forecast(symbol: str, horizon: int = 10, sample_count: int = 5, interval: str = '1d'):
    """
    Generate a Kronos AI price forecast for the given symbol.

    Uses the Kronos-small foundation model to predict future OHLCV candles
    with probabilistic confidence bands (p10/p90 percentiles).

    Args:
        symbol: Yahoo Finance ticker (e.g. RELIANCE.NS). Without .NS suffix
                for NSE stocks it's passed as-is (works for ^NSEI etc.)
        horizon: Number of future bars to predict (1-60, default 10)
        sample_count: Number of probabilistic sample paths (1-10, default 5)
        interval: '1d' for daily bars or '1h' for hourly bars (default '1d')
    """
    from kronos_engine import generate_forecast, _normalize_yahoo_symbol

    # Normalise NSE symbols: append .NS if it looks like a bare stock name
    # (but allow indices like ^NSEI / %5ENSEI and already-suffixed tickers)
    symbol = _normalize_yahoo_symbol(symbol)
    is_index = symbol.startswith('^') or symbol.upper() in {'NIFTY50', 'NIFTY', 'NSEI'}
    if not is_index and '.' not in symbol:
        symbol = f'{symbol}.NS'

    try:
        result = await generate_forecast(symbol, horizon=horizon, sample_count=sample_count, interval=interval)
        return result
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f'Kronos forecast failed for {symbol}: {e}', exc_info=True)
        raise HTTPException(status_code=500, detail=f'Forecast generation failed: {str(e)}')


# ---- Kronos forecast cache (for strategy engine — fast reads) ----

@app.get("/api/forecast/cached/{symbol}")
async def api_cached_forecast(symbol: str):
    """
    Get the pre-computed daily Kronos forecast for a symbol.
    Returns instantly from cache — no model load. Used by the strategy engine.

    Returns 404 if no cached forecast exists (strategy should treat as HOLD).
    """
    from kronos_cache import get_cached_forecast

    # Normalise symbol (same logic as the live forecast endpoint)
    is_index = symbol.startswith('^') or 'NSEI' in symbol.upper() or symbol.upper() == 'NIFTY50'
    if not is_index and '.' not in symbol:
        symbol = f'{symbol}.NS'

    result = get_cached_forecast(symbol)
    if result is None:
        raise HTTPException(status_code=404, detail=f'No cached forecast for {symbol}')
    return result


@app.get("/api/forecast/cache/status")
async def api_cache_status():
    """Get Kronos cache statistics."""
    from kronos_cache import get_cache_status
    return get_cache_status()


@app.get("/api/forecast/cache/all")
async def api_all_cached():
    """Get all cached forecasts (for dashboard/batch reads)."""
    from kronos_cache import get_all_cached_forecasts
    return {'forecasts': get_all_cached_forecasts()}


@app.post("/api/forecast/refresh-cache")
async def api_refresh_cache(symbols: Optional[str] = None):
    """
    Manually trigger a Kronos cache refresh.
    Computes forecasts for all NIFTY50 instruments (or a custom comma-separated list).
    Runs in background — returns immediately with a task ID.
    """
    import asyncio
    import time as _time
    from kronos_engine import generate_forecast
    from kronos_cache import save_forecast_to_cache

    # Determine which symbols to process
    if symbols:
        symbol_list = [s.strip() for s in symbols.split(',')]
    else:
        # Default to key NIFTY50 stocks (limit to 15 for speed)
        symbol_list = [
            'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
            'HINDUNILVR.NS', 'ITC.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'KOTAKBANK.NS',
            'LT.NS', 'AXISBANK.NS', 'MARUTI.NS', 'SUNPHARMA.NS', 'TITAN.NS',
        ]

    task_id = f'kronos-refresh-{int(_time.time())}'

    async def _run_refresh():
        """Background task: compute and cache forecasts."""
        success = 0
        failed = 0
        for sym in symbol_list:
            try:
                result = await generate_forecast(sym, horizon=10, sample_count=3)
                save_forecast_to_cache(sym, result)
                success += 1
                logger.info(f'Kronos cache: {sym} OK')
            except Exception as e:
                failed += 1
                logger.error(f'Kronos cache: {sym} FAILED: {e}')
        logger.info(f'Kronos cache refresh complete: {success} OK, {failed} failed')

    asyncio.create_task(_run_refresh())

    return {
        'task_id': task_id,
        'status': 'running',
        'symbols': symbol_list,
        'message': f'Refreshing {len(symbol_list)} symbols in background. Check /api/forecast/cache/status for progress.'
    }


@app.on_event("startup")
async def startup_event():
    logger.info("Tauric Research Scanner starting...")


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('SCANNER_PORT', '8000'))
    uvicorn.run(app, host='0.0.0.0', port=port)

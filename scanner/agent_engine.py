"""
Tauric Research — TradingAgents Integration
Wraps the real TauricResearch/TradingAgents (10-agent LLM trading firm)
with our OpenAI-compatible LLM gateway.

10+2 Agents across 4 teams:
  Analyst Team:  Market Analyst, Sentiment Analyst, News Analyst, Fundamentals Analyst
  Research Team: Bull Researcher, Bear Researcher (debate), Research Manager (judge)
  Trader:        Composes analyst+research reports → trading decision
  Risk Mgmt:     Aggressive, Neutral, Conservative debaters + Risk Manager (final judge)
"""
import os
import json
import logging
import threading
import time
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

_SCANNER_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCANNER_DIR.parent
load_dotenv(_PROJECT_ROOT / '.env')

logger = logging.getLogger('tauric.agents')

LLM_API_KEY = os.getenv('ANTHROPIC_API_KEY', os.getenv('LLM_API_KEY', ''))
ANTHROPIC_BASE_URL = os.getenv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic')
LLM_BASE_URL = ANTHROPIC_BASE_URL
LLM_MODEL = os.getenv('LLM_MODEL', 'glm-5.1')

# Results directory for TradingAgents logs
RESULTS_DIR = _SCANNER_DIR / 'agent_results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# In-memory task tracking for background analyses
_running_tasks: dict[str, dict] = {}


# Agent metadata for UI display
AGENTS_INFO = [
    # Analyst Team
    {
        'id': 'market_analyst', 'name': 'Market Analyst', 'team': 'Analyst Team',
        'role': 'Technical analysis specialist — MACD, RSI, moving averages, support/resistance, volume patterns.',
        'icon': '📊',
    },
    {
        'id': 'social_analyst', 'name': 'Sentiment Analyst', 'team': 'Analyst Team',
        'role': 'Social media sentiment analysis — Reddit, Twitter/X, retail investor sentiment signals.',
        'icon': '💬',
    },
    {
        'id': 'news_analyst', 'name': 'News Analyst', 'team': 'Analyst Team',
        'role': 'Macro news analysis — earnings, regulatory changes, geopolitical events, economic indicators.',
        'icon': '📰',
    },
    {
        'id': 'fundamentals_analyst', 'name': 'Fundamentals Analyst', 'team': 'Analyst Team',
        'role': 'Financial statement analysis — P/E, revenue growth, margins, debt ratios, insider transactions.',
        'icon': '📋',
    },
    # Research Team
    {
        'id': 'bull_researcher', 'name': 'Bull Researcher', 'team': 'Research Team',
        'role': 'Constructs the bullish investment thesis using analyst reports. Argues for BUY.',
        'icon': '🐂',
    },
    {
        'id': 'bear_researcher', 'name': 'Bear Researcher', 'team': 'Research Team',
        'role': 'Constructs the bearish investment thesis. Challenges the bull case. Argues for SELL.',
        'icon': '🐻',
    },
    {
        'id': 'research_manager', 'name': 'Research Manager', 'team': 'Research Team',
        'role': 'Judges the bull vs bear debate and produces the investment recommendation.',
        'icon': '⚖️',
    },
    # Trader
    {
        'id': 'trader', 'name': 'Trader', 'team': 'Trading',
        'role': 'Composes all analyst and research reports into a structured trading decision with position sizing.',
        'icon': '🎯',
    },
    # Risk Management Team
    {
        'id': 'aggressive_debator', 'name': 'Aggressive Risk Analyst', 'team': 'Risk Management',
        'role': 'Argues for maximum position size and higher risk tolerance. Challenges conservative views.',
        'icon': '🔥',
    },
    {
        'id': 'neutral_debator', 'name': 'Neutral Risk Analyst', 'team': 'Risk Management',
        'role': 'Balanced risk perspective — weighs both upside potential and downside risks.',
        'icon': '🧮',
    },
    {
        'id': 'conservative_debator', 'name': 'Conservative Risk Analyst', 'team': 'Risk Management',
        'role': 'Argues for capital preservation and smaller positions. Challenges aggressive views.',
        'icon': '🛡️',
    },
    {
        'id': 'risk_manager', 'name': 'Risk Manager (Portfolio Manager)', 'team': 'Risk Management',
        'role': 'Final decision maker. Approves or rejects the trade. Sets final position size, targets, and stop loss.',
        'icon': '🏛️',
    },
]


def _setup_llm_env():
    """Configure environment for TradingAgents to use z.ai Anthropic gateway."""
    os.environ['ANTHROPIC_API_KEY'] = LLM_API_KEY
    os.environ['ANTHROPIC_BASE_URL'] = ANTHROPIC_BASE_URL

    # Monkey-patch to remove reasoning_effort param (not supported by z.ai GLM)
    import tradingagents.llm as _llm
    _llm._apply_reasoning = lambda provider, effort, kwargs: None
    _llm.build_chat_model.__globals__['_apply_reasoning'] = _llm._apply_reasoning


def _get_graph():
    """Create a TradingAgentsGraph configured to use our LLM gateway."""
    from tradingagents.config import TradingAgentsConfig
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    _setup_llm_env()

    config = TradingAgentsConfig(
        llm_provider='anthropic',
        deep_think_llm=LLM_MODEL,
        quick_think_llm=LLM_MODEL,
        max_debate_rounds=1,
        max_risk_discuss_rounds=1,
        max_recur_limit=100,
        results_dir=RESULTS_DIR,
    )

    return TradingAgentsGraph(config=config)


def _run_analysis_sync(task_id: str, ticker: str, trade_date: str):
    """Run the full TradingAgents analysis in a background thread."""
    try:
        _running_tasks[task_id]['status'] = 'running'
        _running_tasks[task_id]['started_at'] = datetime.now().isoformat()
        _running_tasks[task_id]['progress'] = 'Initializing 10-agent graph...'

        graph = _get_graph()
        _running_tasks[task_id]['progress'] = 'Agents analyzing data (this takes 3-8 minutes)...'

        final_state, recommendation = graph.propagate(
            company_name=ticker,
            trade_date=trade_date,
        )

        # Extract individual agent reports
        agent_reports = {}
        agent_reports['market_analyst'] = final_state.market_report or ''
        agent_reports['social_analyst'] = final_state.sentiment_report or ''
        agent_reports['news_analyst'] = final_state.news_report or ''
        agent_reports['fundamentals_analyst'] = final_state.fundamentals_report or ''
        agent_reports['situation_summary'] = final_state.situation_summary or ''

        invest_debate = final_state.investment_debate_state
        agent_reports['bull_researcher'] = '\n'.join(invest_debate.bull_history) if invest_debate.bull_history else ''
        agent_reports['bear_researcher'] = '\n'.join(invest_debate.bear_history) if invest_debate.bear_history else ''
        agent_reports['research_manager'] = invest_debate.judge_decision or ''

        agent_reports['trader'] = final_state.trader_investment_plan or ''

        risk_debate = final_state.risk_debate_state
        agent_reports['aggressive_debator'] = '\n'.join(risk_debate.aggressive_history) if risk_debate.aggressive_history else ''
        agent_reports['neutral_debator'] = '\n'.join(risk_debate.neutral_history) if risk_debate.neutral_history else ''
        agent_reports['conservative_debator'] = '\n'.join(risk_debate.conservative_history) if risk_debate.conservative_history else ''
        agent_reports['risk_manager'] = risk_debate.judge_decision or ''

        rec_dict = recommendation.model_dump() if recommendation else {}

        result = {
            'ticker': ticker,
            'trade_date': trade_date,
            'timestamp': datetime.now().isoformat(),
            'agent_reports': agent_reports,
            'final_trade_decision': final_state.final_trade_decision or '',
            'recommendation': rec_dict,
            'agents_metadata': AGENTS_INFO,
        }

        _running_tasks[task_id]['status'] = 'completed'
        _running_tasks[task_id]['result'] = result
        _running_tasks[task_id]['completed_at'] = datetime.now().isoformat()
        _running_tasks[task_id]['progress'] = f'Done: {rec_dict.get("signal", "UNKNOWN")}'

        logger.info(f"Agent analysis {task_id} complete: {rec_dict.get('signal', 'UNKNOWN')}")

    except Exception as e:
        logger.error(f"Agent analysis {task_id} failed: {e}", exc_info=True)
        _running_tasks[task_id]['status'] = 'failed'
        _running_tasks[task_id]['error'] = str(e)
        _running_tasks[task_id]['progress'] = f'Error: {e}'


def start_agent_analysis(ticker: str, trade_date: str = None) -> str:
    """
    Start a TradingAgents analysis in the background.
    Returns a task_id that can be polled for status.
    """
    if not LLM_API_KEY:
        raise ValueError(
            'ANTHROPIC_API_KEY is not set. Add your z.ai API key to .env '
            '(ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, LLM_MODEL=glm-5.1).'
        )

    try:
        import tradingagents  # noqa: F401
    except ImportError as e:
        raise ValueError(
            'TradingAgents Python package is not installed in scanner/.venv. '
            'Run: scanner\\.venv\\Scripts\\pip install tradingagents'
        ) from e

    if trade_date is None:
        trade_date = date.today().isoformat()

    task_id = f"{ticker.replace('.', '_')}_{trade_date}_{int(time.time())}"
    _running_tasks[task_id] = {
        'status': 'queued',
        'ticker': ticker,
        'trade_date': trade_date,
        'progress': 'Queued...',
    }

    thread = threading.Thread(
        target=_run_analysis_sync,
        args=(task_id, ticker, trade_date),
        daemon=True,
    )
    thread.start()

    return task_id


def get_task_status(task_id: str) -> dict:
    """Get the status of a background agent analysis task."""
    if task_id not in _running_tasks:
        return {'status': 'not_found', 'error': 'Task not found'}

    task = _running_tasks[task_id]
    result = {
        'task_id': task_id,
        'status': task['status'],
        'ticker': task.get('ticker'),
        'trade_date': task.get('trade_date'),
        'progress': task.get('progress', ''),
    }

    if task['status'] == 'completed':
        result['result'] = task.get('result')
    elif task['status'] == 'failed':
        result['error'] = task.get('error', 'Unknown error')

    return result


def list_completed_analyses(limit: int = 20) -> list:
    """List all completed agent analyses (from both memory and disk)."""
    results = []

    # From running tasks (recently completed)
    for task_id, task in sorted(_running_tasks.items(), reverse=True):
        if task['status'] == 'completed' and task.get('result'):
            rec = task['result'].get('recommendation', {})
            results.append({
                'ticker': task['result'].get('ticker'),
                'trade_date': task['result'].get('trade_date'),
                'signal': rec.get('signal', 'UNKNOWN'),
                'confidence': rec.get('confidence', 0),
                'size_fraction': rec.get('size_fraction', 0),
                'target_price': rec.get('target_price'),
                'stop_loss': rec.get('stop_loss'),
                'task_id': task_id,
            })

    # From disk (older results saved by TradingAgents)
    if RESULTS_DIR.exists():
        for ticker_dir in sorted(RESULTS_DIR.iterdir(), reverse=True):
            if not ticker_dir.is_dir():
                continue
            for log_file in sorted(ticker_dir.glob("full_states_log_*.json"), reverse=True):
                if len(results) >= limit:
                    break
                try:
                    data = json.loads(log_file.read_text())
                    runs = data.get('runs', {})
                    for trade_date_key, run_data in runs.items():
                        rec = run_data.get('final_trade_recommendation', {})
                        ticker_display = run_data.get('company_of_interest', ticker_dir.name.replace('_', '.'))
                        # Avoid duplicates from memory
                        if any(r['ticker'] == ticker_display and r['trade_date'] == trade_date_key for r in results):
                            continue
                        results.append({
                            'ticker': ticker_display,
                            'trade_date': trade_date_key,
                            'signal': rec.get('signal', 'UNKNOWN') if rec else 'UNKNOWN',
                            'confidence': rec.get('confidence', 0) if rec else 0,
                            'size_fraction': rec.get('size_fraction', 0) if rec else 0,
                            'target_price': rec.get('target_price') if rec else None,
                            'stop_loss': rec.get('stop_loss') if rec else None,
                            'log_file': str(log_file),
                        })
                except Exception:
                    continue

    return results[:limit]


def get_agent_reports_from_log(ticker: str, trade_date: str) -> Optional[dict]:
    """Load a previously saved agent analysis from disk."""
    safe_ticker = ticker.replace('.', '_').replace('/', '_')
    log_path = RESULTS_DIR / safe_ticker / f"full_states_log_{safe_ticker}_{trade_date}.json"

    if not log_path.exists():
        return None

    with open(log_path, 'r') as f:
        data = json.load(f)

    return data

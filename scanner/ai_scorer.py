"""
Tauric Research — Claude API integration for M7 AI Composite scoring.
Uses the OpenAI-compatible LLM gateway.
"""
import json
import httpx
import asyncio
import logging
from config import ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, LLM_MODEL

logger = logging.getLogger('tauric.ai')

SYSTEM_PROMPT = """You are Tauric Research, an NSE/BSE swing trade analysis agent.
You receive a stock's technical summary and must output ONLY valid JSON.
No explanation. No preamble. JSON only.

Output schema:
{
  "symbol": string,
  "score": number (1-10),
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "entry_low": number,
  "entry_high": number,
  "stop_loss": number,
  "target_1": number,
  "target_2": number,
  "hold_days_min": number,
  "hold_days_max": number,
  "methods_triggered": [string],
  "tags": [string],
  "risk_tag": string,
  "key_risk": string
}

Scoring rules:
- Score 8-10: ≥3 methods triggered + strong fundamentals + institutional buying
- Score 6-7: 2 methods triggered + one of earnings beat or FII buying
- Score <6: single method, weak confirmation
- Apply OVEREXTENDED tag if RSI > 75 at potential entry
- Apply FAKEOUT risk if breakout is less than 5 days old with no volume follow-through

Valid tags: BREAKOUT, EARNINGS_BEAT, FII_BUYING, SECTOR_MOMENTUM, OVERSOLD_BOUNCE, ENGULFING
Valid risk_tags: FAKEOUT, NEWS_DRIVEN, OVEREXTENDED, SECTOR_HEADWIND, LIQUIDITY_TRAP, CLEAR"""


def build_user_prompt(symbol: str, summary: dict, methods_triggered: list,
                      regime: str, vix: float) -> str:
    """Build the dynamic user prompt for a single stock."""
    return f"""Stock: {symbol}
Sector: {summary.get('sector', 'Unknown')}
Last close: ₹{summary['close']}
52W high: ₹{summary['high_52w']}, low: ₹{summary['low_52w']}
ATR(14): {summary['atr_pct']}%
RSI(14): {summary['rsi']}
MACD signal: {summary['macd_signal']}
EMA20 vs EMA50: {summary['ema_status']}
Volume vs 20D avg: {summary['vol_ratio']}x
Methods triggered: {', '.join(methods_triggered) if methods_triggered else 'None'}
Market regime today: {regime}
India VIX: {vix}"""


async def score_stock_with_ai(symbol: str, summary: dict, methods_triggered: list,
                               regime: str, vix: float) -> dict | None:
    """
    Call Claude API to score a stock. Returns parsed JSON or None on failure.
    """
    if not (ANTHROPIC_API_KEY or '').strip():
        logger.error(
            'AI scoring skipped for %s — ANTHROPIC_API_KEY / LLM_API_KEY is not set',
            symbol,
        )
        return None

    user_prompt = build_user_prompt(symbol, summary, methods_triggered, regime, vix)

    payload = {
        'model': LLM_MODEL,
        'max_tokens': 4096,
        'system': SYSTEM_PROMPT,
        'messages': [
            {'role': 'user', 'content': user_prompt},
        ],
    }

    headers = {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            url = f'{ANTHROPIC_BASE_URL.rstrip("/")}/v1/messages'
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.error(f"LLM API error {resp.status_code} for {symbol}: {resp.text[:200]}")
                return None

            data = resp.json()
            content_blocks = data.get('content', [])
            content = ''
            for block in content_blocks:
                if block.get('type') == 'text':
                    content += block.get('text', '')

            # Parse JSON from response (handle markdown code blocks)
            content = content.strip()
            if content.startswith('```'):
                # Remove markdown code fence
                lines = content.split('\n')
                content = '\n'.join(lines[1:-1] if lines[-1].startswith('```') else lines[1:])

            result = json.loads(content)

            # Coerce numeric fields — LLM may return strings or booleans
            numeric_fields = ['score', 'entry_low', 'entry_high', 'stop_loss',
                              'target_1', 'target_2', 'hold_days_min', 'hold_days_max']
            for field in numeric_fields:
                if field in result:
                    try:
                        result[field] = float(result[field])
                    except (ValueError, TypeError):
                        pass

            # Validate required fields
            required = ['score', 'entry_low', 'entry_high', 'stop_loss', 'target_1', 'target_2']
            for field in required:
                if field not in result:
                    logger.warning(f"Missing field {field} in AI response for {symbol}")
                    return None

            # Auto-apply OVEREXTENDED if RSI > 75
            tags = result.get('tags', [])
            if summary['rsi'] > 75 and 'OVEREXTENDED' not in tags:
                tags.append('OVEREXTENDED')
                result['tags'] = tags

            # Auto-apply FAKEOUT risk if breakout < 5 days with low volume
            if 'M1' in methods_triggered and summary['vol_ratio'] < 1.5:
                result['risk_tag'] = result.get('risk_tag', 'FAKEOUT')

            result['symbol'] = symbol
            result['methods_triggered'] = methods_triggered
            return result

    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse failed for {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"AI scoring failed for {symbol}: {e}")
        return None

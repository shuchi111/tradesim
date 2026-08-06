"""
CI / GitHub Actions — run Tauric daily scan with AI scoring (M7) required.
Fails fast if ANTHROPIC_API_KEY / LLM_API_KEY is missing.
"""
import asyncio
import os
import sys


def _require_llm() -> None:
    key = (os.getenv('ANTHROPIC_API_KEY') or os.getenv('LLM_API_KEY') or '').strip()
    if not key:
        print(
            'ERROR: Daily scan requires AI scoring.\n'
            'Set GitHub secret ANTHROPIC_API_KEY (or LLM_API_KEY).\n'
            'Optional: ANTHROPIC_BASE_URL, LLM_MODEL.',
            file=sys.stderr,
        )
        sys.exit(1)
    base = os.getenv('ANTHROPIC_BASE_URL') or os.getenv('LLM_BASE_URL') or 'https://api.z.ai/api/anthropic'
    model = os.getenv('LLM_MODEL') or 'glm-5.1'
    print(f'LLM OK — model={model} base={base}')


async def main() -> None:
    _require_llm()
    from database import init_db
    from scanner_engine import run_full_scan

    init_db()
    result = await run_full_scan()
    picks = result.get('picks') or []
    print(
        f'Done: {len(picks)} picks, regime={result.get("regime")}, '
        f'VIX={result.get("vix")}, AI-scored={all("score" in p for p in picks)}'
    )
    if picks:
        for p in picks[:5]:
            print(f'  - {p.get("symbol")}: score={p.get("score")} conf={p.get("confidence")}')


if __name__ == '__main__':
    asyncio.run(main())

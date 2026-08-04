/**
 * CI / GitHub Actions — single auto-trade cycle (no long-running loop).
 * Intended to run every 10–15 minutes during NSE hours via cron.
 */
import { runAutoTrade } from '../../src/lib/trading'

function isNseSessionUtc(now = new Date()): boolean {
  const day = now.getUTCDay() // 0 Sun … 6 Sat
  if (day === 0 || day === 6) return false

  // NSE 9:15–15:30 IST = 03:45–10:00 UTC
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const open = 3 * 60 + 45
  const close = 10 * 60 + 0
  return mins >= open && mins <= close
}

async function main() {
  if (!isNseSessionUtc()) {
    console.log('[ci-autotrade] Outside NSE session (UTC) — skipping')
    return
  }

  console.log('[ci-autotrade] Running one auto-trade cycle...')
  const results = await runAutoTrade()
  const actionable = results.filter((r) => r.action !== 'NO_SIGNALS')
  if (actionable.length === 0) {
    console.log('[ci-autotrade] No actionable signals')
  } else {
    for (const r of actionable) {
      console.log(`[ci-autotrade] ${r.action}: ${r.instrument} — ${r.detail.slice(0, 120)}`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[ci-autotrade] Failed:', err)
    process.exit(1)
  })

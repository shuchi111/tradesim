/**
 * CI / GitHub Actions — run a portfolio backtest and notify the UI.
 *
 * Env:
 *   BACKTEST_LOOKBACK_DAYS — default 3650 (~10 years) so AI Score historical
 *   win-rate uses a long sample. Override to 90 for a faster smoke run.
 */
import 'dotenv/config'
import { INSTRUMENTS } from '../../src/types'
import { runBacktest, saveBacktest } from '../../src/lib/backtest'
import { createNotification } from '../../src/lib/trading'

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const lookback = Math.max(
    90,
    Number(process.env.BACKTEST_LOOKBACK_DAYS || 3650) || 3650
  )
  const endDate = isoDaysAgo(0)
  const startDate = isoDaysAgo(lookback)
  const symbols = INSTRUMENTS
    .filter((i) => i.currency === 'INR' && i.symbol !== 'NIFTY50')
    .map((i) => i.symbol)

  const yearsLabel = (lookback / 365.25).toFixed(1)
  console.log(
    `[ci-backtest] Running ${startDate} → ${endDate} (~${yearsLabel}y) on ${symbols.length} symbols...`
  )

  const config = {
    symbols,
    startDate,
    endDate,
    startingCapital: 100_000,
    name: `${yearsLabel}yr Backtest ${startDate} → ${endDate}`,
  }

  const metrics = await runBacktest(config)
  const id = await saveBacktest(config, metrics)

  await createNotification(
    'backtest_ready',
    'Daily Backtest Ready',
    `Backtest #${id}: ${metrics.totalReturnPct >= 0 ? '+' : ''}${metrics.totalReturnPct.toFixed(1)}% return, ${metrics.totalTrades} trades, ${metrics.winRate.toFixed(0)}% win rate. Open Backtest tab.`,
    metrics.totalReturnPct >= 0 ? 'success' : 'warning'
  )

  console.log(
    `[ci-backtest] Done id=${id} return=${metrics.totalReturnPct.toFixed(1)}% trades=${metrics.totalTrades} wr=${metrics.winRate.toFixed(0)}%`
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[ci-backtest] Failed:', err)
    process.exit(1)
  })

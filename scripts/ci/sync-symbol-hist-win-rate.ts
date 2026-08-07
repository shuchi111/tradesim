/**
 * Build / refresh per-symbol historical win-rate cache for AI Score (10% weight).
 *
 * Runs single-symbol backtests over a long horizon (default 10 years) so WR is
 * not distorted by portfolio position limits. Universe = all Nifty 50 stocks.
 *
 *   npx tsx --env-file=.env --tsconfig tsconfig.json scripts/ci/sync-symbol-hist-win-rate.ts
 *
 * Env:
 *   HIST_WR_YEARS=10            lookback years (default 10)
 *   HIST_WR_SYMBOL_LIMIT=       optional cap for testing (omit = all Nifty 50)
 *   HIST_WR_SAVE_BACKTESTS=1    also persist full Backtest rows (default off)
 */
import 'dotenv/config'
import { NIFTY50_STOCKS } from '../../src/types'
import { runBacktest, saveBacktest } from '../../src/lib/backtest'
import { upsertSymbolBacktestPerf } from '../../src/lib/ml/historical-win-rate'
import { createNotification } from '../../src/lib/trading'

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function yearsToDays(years: number): number {
  return Math.round(years * 365.25)
}

async function main() {
  const years = Number(process.env.HIST_WR_YEARS || '10')
  const limitRaw = process.env.HIST_WR_SYMBOL_LIMIT
  const limit =
    limitRaw != null && limitRaw !== '' ? Number(limitRaw) : null
  const saveBacktests = process.env.HIST_WR_SAVE_BACKTESTS === '1'

  const endDate = isoDaysAgo(0)
  const startDate = isoDaysAgo(yearsToDays(years))

  let symbols = NIFTY50_STOCKS.map((i) => i.symbol)
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    symbols = symbols.slice(0, limit)
  }

  console.log(
    `[hist-wr] Single-symbol backtests ${startDate} → ${endDate} (~${years}y) for ${symbols.length} Nifty 50 symbols`
  )

  let ok = 0
  let failed = 0
  const summaries: string[] = []

  for (const symbol of symbols) {
    try {
      console.log(`[hist-wr] ${symbol}…`)
      const config = {
        symbols: [symbol],
        startDate,
        endDate,
        startingCapital: 100_000,
        name: `Hist WR ${symbol} ${startDate}→${endDate}`,
      }

      const metrics = await runBacktest(config)
      const closed = metrics.trades.filter((t) => t.exitDate != null && t.pnl != null)
      const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length
      const losses = closed.length - wins
      const winRate =
        closed.length > 0 ? (wins / closed.length) * 100 : 50
      const avgPnlPct =
        closed.length > 0
          ? closed.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / closed.length
          : 0

      let backtestId: number | null = null
      if (saveBacktests) {
        backtestId = await saveBacktest(config, metrics)
      }

      await upsertSymbolBacktestPerf({
        symbol,
        winRate,
        totalTrades: closed.length,
        wins,
        losses,
        avgPnlPct,
        rangeStart: new Date(startDate),
        rangeEnd: new Date(endDate),
        years,
        backtestId,
      })

      ok++
      const line = `${symbol}: ${winRate.toFixed(0)}% WR (${closed.length} trades)`
      summaries.push(line)
      console.log(`[hist-wr] ${line}`)
    } catch (e) {
      failed++
      console.error(`[hist-wr] ${symbol} FAILED:`, e)
    }
  }

  await createNotification(
    'system',
    'Historical WR Cache Updated',
    `Symbol backtest WR: ${ok} ok, ${failed} failed (~${years}y). AI Score uses this for the 10% Historical Win Rate.`,
    failed > 0 ? 'warning' : 'success'
  )

  console.log(`[hist-wr] Done. ok=${ok} failed=${failed}`)
  if (summaries.length) {
    console.log(summaries.join('\n'))
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[hist-wr] Failed:', err)
    process.exit(1)
  })

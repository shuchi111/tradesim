/**
 * CI / GitHub Actions — generate today's daily report once.
 */
import { generateDailyReport } from '../../src/lib/reports/daily-report'
import { createNotification } from '../../src/lib/trading'

async function main() {
  const now = new Date()
  console.log(`[ci-report] Generating daily report for ${now.toISOString()}...`)
  const report = await generateDailyReport(now)
  await createNotification(
    'report',
    'Daily Report Ready',
    `Report for ${now.toLocaleDateString('en-IN')} — P&L: ${report.dailyPnl >= 0 ? '+' : ''}${report.dailyPnl.toFixed(2)} (${report.dailyPnlPct >= 0 ? '+' : ''}${report.dailyPnlPct.toFixed(2)}%), ${report.tradesCount} trades, ${report.winRate.toFixed(0)}% win rate`,
    'info'
  )
  console.log(
    `[ci-report] Done — P&L ${report.dailyPnl.toFixed(2)}, trades ${report.tradesCount}, win ${report.winRate.toFixed(0)}%`
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[ci-report] Failed:', err)
    process.exit(1)
  })

/**
 * Daily Report Scheduler — Generates daily reports at 4:00 PM IST (10:30 UTC).
 *
 * Runs as a background service. Checks every 5 minutes if it's time to generate.
 * Reports are stored in the DailyReport table and available via the API/UI.
 */

require('dotenv').config({ path: '/workspace/.env' })

import { generateDailyReport } from '../src/lib/reports/daily-report'
import { createNotification } from '../src/lib/trading'

const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const REPORT_HOUR_UTC = 10 // 10:30 UTC = 4:00 PM IST
const REPORT_MINUTE_UTC = 30
let lastReportDate: string | null = null

async function checkAndGenerate() {
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  // Skip if already generated for today
  if (lastReportDate === todayStr) return

  // Check if it's report time (after 12:30 UTC)
  if (now.getUTCHours() > REPORT_HOUR_UTC ||
      (now.getUTCHours() === REPORT_HOUR_UTC && now.getUTCMinutes() >= REPORT_MINUTE_UTC)) {
    try {
      console.log(`[${now.toISOString()}] 📊 Generating daily report...`)
      const report = await generateDailyReport(now)
      lastReportDate = todayStr
      console.log(`[${now.toISOString()}] ✅ Daily report generated: P&L $${report.dailyPnl.toFixed(2)}, ${report.tradesCount} trades, ${report.winRate.toFixed(0)}% win rate`)

      // Create notification
      await createNotification(
        'report',
        'Daily Report Ready',
        `Report for ${now.toLocaleDateString('en-IN')} — P&L: ${report.dailyPnl >= 0 ? '+' : ''}$${report.dailyPnl.toFixed(2)} (${report.dailyPnlPct >= 0 ? '+' : ''}${report.dailyPnlPct.toFixed(2)}%), ${report.tradesCount} trades, ${report.winRate.toFixed(0)}% win rate`,
        'info'
      )
    } catch (e) {
      console.error(`[${now.toISOString()}] ❌ Report generation failed:`, e instanceof Error ? e.message : e)
    }
  }
}

// Start
console.log(`[${new Date().toISOString()}] 📊 Daily Report Scheduler started — generates at ~6:00 PM IST`)

// Initial check after 30s delay
setTimeout(() => {
  checkAndGenerate()
  setInterval(checkAndGenerate, CHECK_INTERVAL_MS)
}, 30_000)

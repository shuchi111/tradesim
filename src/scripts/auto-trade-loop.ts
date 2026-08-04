/**
 * Server-Side Auto-Trade Loop
 *
 * Runs as a background service. Every 2 minutes it checks:
 *   1. Is auto-trade enabled in the DB (AutoTradeConfig.enabled)?
 *   2. Is it Indian market hours (9:15 AM – 3:30 PM IST, Mon–Fri)?
 *
 * If both are true, it calls runAutoTrade() — the exact same function
 * the browser was calling via POST /api/strategy/autotrade.
 *
 * This means trading continues even with no browser tab open.
 *
 * Run via: npx tsx src/scripts/auto-trade-loop.ts
 */

import { runAutoTrade } from '@/lib/trading'
import { prisma } from '@/lib/prisma'

const POLL_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes

/**
 * Check if Indian stock market is open.
 * NSE/BSE hours: 9:15 AM – 3:30 PM IST, Monday–Friday.
 */
function isMarketOpen(): boolean {
  // Indian Standard Time is UTC+5:30
  const now = new Date()
  const istOffsetMs = 5.5 * 60 * 60 * 1000
  const istDate = new Date(now.getTime() + istOffsetMs)

  const istDay = istDate.getUTCDay()
  if (istDay === 0 || istDay === 6) return false // weekend (Sun=0, Sat=6)

  const istHour = istDate.getUTCHours()
  const istMin = istDate.getUTCMinutes()
  const istTotalMin = istHour * 60 + istMin

  // Market open: 9:15 – 15:30 IST
  const marketOpen = 9 * 60 + 15   // 555 min
  const marketClose = 15 * 60 + 30 // 930 min
  return istTotalMin >= marketOpen && istTotalMin <= marketClose
}

async function isAutoTradeEnabled(): Promise<boolean> {
  try {
    const config = await prisma.autoTradeConfig.findUnique({ where: { id: 1 } })
    return config?.enabled ?? false
  } catch {
    return false
  }
}

function istTimeString(): string {
  const now = new Date()
  const istOffsetMs = 5.5 * 60 * 60 * 1000
  const istDate = new Date(now.getTime() + istOffsetMs)
  const h = istDate.getUTCHours().toString().padStart(2, '0')
  const m = istDate.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m} IST`
}

async function mainLoop() {
  console.log(`[auto-trade-loop] Started at ${istTimeString()}. Polling every 2 minutes.`)

  while (true) {
    try {
      const enabled = await isAutoTradeEnabled()
      const marketOpen = isMarketOpen()

      if (enabled && marketOpen) {
        console.log(`[auto-trade-loop] Running auto-trade (${istTimeString()}, market open)...`)
        const results = await runAutoTrade()
        const actionable = results.filter((r) => r.action !== 'NO_SIGNALS')
        if (actionable.length > 0) {
          for (const r of actionable) {
            console.log(`  ${r.action}: ${r.instrument} — ${r.detail.slice(0, 120)}`)
          }
        } else {
          console.log('  No actionable signals.')
        }
      } else {
        const reason = !enabled ? 'auto-trade disabled' : `market closed (${istTimeString()})`
        console.log(`[auto-trade-loop] Skipping — ${reason}`)
      }
    } catch (err) {
      console.error('[auto-trade-loop] Error:', err instanceof Error ? err.message : err)
    }

    // Sleep until next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

mainLoop().catch((err) => {
  console.error('[auto-trade-loop] Fatal error:', err)
  process.exit(1)
})

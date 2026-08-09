/**
 * Auto-Trade Runner — Background service that runs the strategy every 2 minutes.
 *
 * This script runs as a background service (via procmgr), independently of
 * the browser. It keeps the trading strategy running 24/7.
 *
 * Risk management is built into runAutoTrade():
 *   - Circuit breaker on >8% drawdown
 *   - Stop-loss at -7%, take-profit at +15%
 *   - Max 10 positions, 20% cash reserve
 *   - Confidence-based position sizing
 */

// Load .env BEFORE any other imports (tsx auto-loads but let's be explicit)
require('dotenv').config({ path: '/workspace/.env' })

import { runAutoTrade, getRiskStatus } from '../src/lib/trading'

const RUN_INTERVAL_MS = 120_000 // 2 minutes
const MAX_ERRORS = 5
let consecutiveErrors = 0

async function runCycle() {
  try {
    const risk = await getRiskStatus()
    console.log(
      `[${new Date().toISOString()}] Auto-trade cycle | ` +
      `Equity: $${risk.totalEquity.toFixed(0)} | ` +
      `Cash: $${risk.cashAvailable.toFixed(0)} (${risk.cashPct.toFixed(1)}%) | ` +
      `Positions: ${risk.positionsCount} (unlimited) | ` +
      `Drawdown: ${risk.drawdownPct.toFixed(2)}% | ` +
      `Daily P&L: $${risk.dailyPnl.toFixed(0)} | ` +
      `${risk.circuitBreakerActive ? '⚠️ CIRCUIT BREAKER ACTIVE' : '✅ Normal'}`
    )

    const results = await runAutoTrade()

    const actions = results.filter(
      (r) => r.action === 'BOUGHT' || r.action === 'SOLD'
    )

    if (actions.length > 0) {
      for (const a of actions) {
        const pnlStr = a.pnl !== undefined ? ` | P&L: $${a.pnl.toFixed(2)} (${a.pnlPct?.toFixed(1)}%)` : ''
        console.log(`  → ${a.action} ${a.instrument}${pnlStr} — ${a.detail}`)
      }
    } else {
      const skipped = results.find((r) =>
        r.action === 'CIRCUIT_BREAKER' || r.action === 'MAX_POSITIONS' ||
        r.action === 'LOW_CASH' || r.action === 'NO_SIGNALS'
      )
      if (skipped) {
        console.log(`  → ${skipped.action}: ${skipped.detail}`)
      } else {
        console.log('  → No actionable trades this cycle.')
      }
    }

    consecutiveErrors = 0
  } catch (e) {
    consecutiveErrors++
    console.error(
      `[${new Date().toISOString()}] ❌ Auto-trade error (${consecutiveErrors}/${MAX_ERRORS}):`,
      e instanceof Error ? e.message : e
    )
    if (consecutiveErrors >= MAX_ERRORS) {
      console.error('Too many consecutive errors. Exiting.')
      process.exit(1)
    }
  }
}

// Initial run after a short delay (let the app server start first)
console.log(`[${new Date().toISOString()}] 🤖 Auto-Trade Runner started — runs every ${RUN_INTERVAL_MS / 1000}s`)

setTimeout(() => {
  runCycle()
  setInterval(runCycle, RUN_INTERVAL_MS)
}, 10_000) // 10s initial delay

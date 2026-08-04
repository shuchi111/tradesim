/**
 * Fix script: Update closed trades that recorded pnl=0 (exitPrice === entryPrice).
 *
 * These trades were closed during portfolio rebalancing without capturing the
 * live market price as the exit. This script:
 *  1. Finds all CustomStrategyTrade records where pnl === 0
 *  2. Fetches the current market price for each symbol
 * 3. Recalculates exitPrice and pnl
 *  4. Adjusts the account balance for the difference
 */

import { prisma } from '../src/lib/prisma'
import { getMarketPrice } from '../src/lib/trading'

async function main() {
  // Find all closed trades with zero P&L
  const badTrades = await prisma.customStrategyTrade.findMany()

  console.log(`\nFound ${badTrades.length} closed trades total.`)

  const toFix = badTrades.filter((t) => t.pnl === 0)

  if (toFix.length === 0) {
    console.log('✅ No break-even trades to fix. All trades have real P&L.')
    return
  }

  console.log(`\n🔧 Fixing ${toFix.length} break-even trades:\n`)

  let totalAdjustment = 0

  for (const trade of toFix) {
    try {
      const currentPrice = await getMarketPrice(trade.symbol)
      const correctPnl =
        (currentPrice - trade.entryPrice) * trade.quantity

      const oldExit = trade.exitPrice
      const oldPnl = trade.pnl

      await prisma.customStrategyTrade.update({
        where: { id: trade.id },
        data: {
          exitPrice: currentPrice,
          pnl: correctPnl,
        },
      })

      // The account was originally credited with entryPrice * qty
      // It should have been credited with currentPrice * qty
      // So we need to adjust by the difference
      const adjustment = (currentPrice - oldExit) * trade.quantity
      totalAdjustment += adjustment

      console.log(
        `  ${trade.symbol.padEnd(12)} | Entry: $${trade.entryPrice.toFixed(4)} → Exit: $${oldExit.toFixed(4)} → $${currentPrice.toFixed(4)} | ` +
        `P&L: $${oldPnl.toFixed(2)} → $${correctPnl.toFixed(2)} | ` +
        `Qty: ${trade.quantity.toFixed(2)} | Balance adj: ${adjustment >= 0 ? '+' : ''}$${adjustment.toFixed(2)}`
      )
    } catch (err) {
      console.log(`  ⚠️  ${trade.symbol}: Failed to fetch price — skipping`)
    }
  }

  // Adjust account balance
  if (Math.abs(totalAdjustment) > 0.01) {
    const account = await prisma.account.findUnique({ where: { id: 1 } })
    if (account) {
      const oldBalance = account.balance
      await prisma.account.update({
        where: { id: 1 },
        data: { balance: oldBalance + totalAdjustment },
      })
      console.log(
        `\n💰 Account balance adjusted: $${oldBalance.toFixed(2)} → $${(oldBalance + totalAdjustment).toFixed(2)} (${totalAdjustment >= 0 ? '+' : ''}$${totalAdjustment.toFixed(2)})`
      )
    }
  }

  // Verify the fix
  const fixed = await prisma.customStrategyTrade.findMany()
  const wins = fixed.filter((t) => t.pnl > 0).length
  const losses = fixed.filter((t) => t.pnl < 0).length
  const totalPnl = fixed.reduce((s, t) => s + t.pnl, 0)

  console.log(`\n✅ Fix complete!`)
  console.log(`   Total closed trades: ${fixed.length}`)
  console.log(`   Wins: ${wins} | Losses: ${losses}`)
  console.log(`   Win Rate: ${fixed.length > 0 ? ((wins / fixed.length) * 100).toFixed(1) : 0}%`)
  console.log(`   Total Realized P&L: $${totalPnl.toFixed(2)}\n`)
}

main()
  .catch((e) => {
    console.error('Fix script failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

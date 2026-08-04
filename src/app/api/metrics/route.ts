import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureAccount } from '@/lib/trading'
import { getMarketPrice } from '@/lib/trading'
import { calculateMetrics } from '@/lib/metrics'

export async function GET() {
  try {
    const account = await ensureAccount()
    const closedTrades = await prisma.customStrategyTrade.findMany({
      orderBy: { closedAt: 'desc' },
      take: 200,
    })

    // Get current positions value for equity
    const positions = await prisma.position.findMany()
    let positionsValue = 0
    let unrealizedPnl = 0
    for (const p of positions) {
      try {
        const price = await getMarketPrice(p.symbol)
        positionsValue += price * p.quantity
        unrealizedPnl += (price - p.entryPrice) * p.quantity
      } catch {
        positionsValue += p.entryPrice * p.quantity
      }
    }

    const currentEquity = account.balance + positionsValue

    // Backfill deposits if SIP ran but totalDeposited wasn't set (e.g. migrated data)
    let totalDeposited = account.totalDeposited ?? 0
    if (totalDeposited <= 0 && account.lastSipDate) {
      totalDeposited = account.sipAmountInr
      await prisma.account.update({
        where: { id: 1 },
        data: { totalDeposited },
      })
    }

    const tradeRecords = closedTrades.map((t) => ({
      pnl: t.pnl,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
    }))

    const metrics = calculateMetrics(tradeRecords, account.startingEquity, currentEquity, {
      startDate: account.createdAt,
      totalDeposited,
      deposits: account.lastSipDate
        ? [{ date: account.lastSipDate, amount: account.sipAmountInr }]
        : [],
    })

    return NextResponse.json({
      data: {
        ...metrics,
        currentEquity,
        startingEquity: account.startingEquity,
        balance: account.balance,
        positionsValue,
        unrealizedPnl,
        sipAmountInr: account.sipAmountInr,
        lastSipDate: account.lastSipDate,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 })
  }
}

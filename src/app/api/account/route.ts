import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureAccount, getMarketPrice } from '@/lib/trading'

export async function GET() {
  try {
    const account = await ensureAccount()
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

    const equity = account.balance + positionsValue

    // Ensure SIP deposits are tracked for P&L (exclude from profit)
    let totalDeposited = account.totalDeposited ?? 0
    if (totalDeposited <= 0 && account.lastSipDate) {
      totalDeposited = account.sipAmountInr
      await prisma.account.update({
        where: { id: 1 },
        data: { totalDeposited },
      })
    }

    return NextResponse.json({
      data: {
        balance: account.balance,
        startingEquity: account.startingEquity,
        equity,
        positionsValue,
        balanceInr: account.balance,
        equityInr: equity,
        positionsValueInr: positionsValue,
        unrealizedPnl,
        unrealizedPnlInr: unrealizedPnl,
        sipAmountInr: account.sipAmountInr,
        lastSipDate: account.lastSipDate,
        totalDeposited,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch account data' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  ensureAccount,
  getMarketPrice,
  resetPortfolio,
  SIP_DAY_OF_MONTH,
} from '@/lib/trading'

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
        sipDayOfMonth: account.sipDayOfMonth ?? SIP_DAY_OF_MONTH,
        sipEligibleFrom: account.sipEligibleFrom,
        lastSipDate: account.lastSipDate,
        totalDeposited,
        cashReservePct: 0.3,
        maxAllocationPerTrade: null,
        maxPositionsAllowed: null,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch account data' }, { status: 500 })
  }
}

/** POST { action: "reset" } — reset to ₹1L and schedule SIP from the 7th of next month. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.action !== 'reset') {
      return NextResponse.json(
        { error: 'Unsupported action. Use { "action": "reset" }.' },
        { status: 400 }
      )
    }

    const result = await resetPortfolio()
    return NextResponse.json({
      data: {
        ...result,
        message:
          `Portfolio reset to ₹1,00,000. Open positions cleared. SIP of ₹20,000 starts on the ${SIP_DAY_OF_MONTH}th of next month.`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset portfolio'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

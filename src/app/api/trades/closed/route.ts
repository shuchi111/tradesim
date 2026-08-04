import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const closed = await prisma.customStrategyTrade.findMany({
      orderBy: { closedAt: 'desc' },
      take: 100,
    })

    const totalTrades = closed.length
    const wins = closed.filter((c) => c.pnl > 0).length
    const losses = closed.filter((c) => c.pnl < 0).length
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
    const totalPnl = closed.reduce((sum, c) => sum + c.pnl, 0)

    return NextResponse.json({
      data: closed,
      stats: {
        totalTrades,
        wins,
        losses,
        winRate,
        totalPnl,
        realizedPnl: totalPnl,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch closed positions' }, { status: 500 })
  }
}

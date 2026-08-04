import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/trades/intelligence
 * Returns trade intelligence analytics: exit reason breakdown, MFE/MAE, etc.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')

  const trades = await prisma.customStrategyTrade.findMany({
    take: limit,
    orderBy: { closedAt: 'desc' },
  })

  // Exit reason breakdown
  const exitReasons: Record<string, { count: number; totalPnl: number; avgPnlPct: number }> = {}
  for (const t of trades) {
    const reason = t.exitReason || 'manual'
    if (!exitReasons[reason]) {
      exitReasons[reason] = { count: 0, totalPnl: 0, avgPnlPct: 0 }
    }
    exitReasons[reason].count++
    exitReasons[reason].totalPnl += t.pnl
    const pnlPct = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100
    exitReasons[reason].avgPnlPct += pnlPct
  }
  for (const reason of Object.keys(exitReasons)) {
    exitReasons[reason].avgPnlPct /= exitReasons[reason].count
  }

  // Entry reason breakdown
  const entryReasons: Record<string, { count: number; totalPnl: number; winRate: number }> = {}
  for (const t of trades) {
    const reason = t.entryReason || 'manual'
    if (!entryReasons[reason]) {
      entryReasons[reason] = { count: 0, totalPnl: 0, winRate: 0 }
    }
    entryReasons[reason].count++
    entryReasons[reason].totalPnl += t.pnl
    if (t.pnl > 0) entryReasons[reason].winRate++
  }
  for (const reason of Object.keys(entryReasons)) {
    entryReasons[reason].winRate = (entryReasons[reason].winRate / entryReasons[reason].count) * 100
  }

  // MFE/MAE analysis
  const mfeMae = trades
    .filter(t => t.maxFavorable != null && t.maxAdverse != null)
    .map(t => ({
      tradeId: t.id,
      symbol: t.symbol,
      mfe: t.maxFavorable ?? 0,
      mae: t.maxAdverse ?? 0,
      pnl: t.pnl,
      pnlPct: ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100,
      exitReason: t.exitReason,
    }))

  // Recent events (last 20)
  const recentEvents = await prisma.trailingStopEvent.findMany({
    take: 20,
    orderBy: { timestamp: 'desc' },
  })

  return NextResponse.json({
    exitReasonBreakdown: exitReasons,
    entryReasonBreakdown: entryReasons,
    mfeMae,
    recentEvents,
    totalTrades: trades.length,
  })
}

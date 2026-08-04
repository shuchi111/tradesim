import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/trades/timeline/:id
 * Returns the full lifecycle events for a closed trade.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const tradeId = parseInt(id)

  const trade = await prisma.customStrategyTrade.findUnique({
    where: { id: tradeId },
  })

  if (!trade) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }

  // Get all risk events for this symbol around the trade timeframe
  const events = await prisma.trailingStopEvent.findMany({
    where: {
      symbol: trade.symbol,
      timestamp: {
        gte: trade.openedAt,
        lte: trade.closedAt,
      },
    },
    orderBy: { timestamp: 'asc' },
  })

  // Build timeline
  const timeline = []

  // Entry event
  timeline.push({
    type: 'entry',
    timestamp: trade.openedAt,
    title: `Position Opened: ${trade.symbol}`,
    description: `Bought ${trade.quantity.toFixed(4)} units @ ₹${trade.entryPrice.toFixed(2)}`,
    details: trade.entryDetails,
    pnlPct: 0,
  })

  // Risk events in between
  for (const evt of events) {
    if (evt.eventType === 'entry') continue // already covered
    let icon = '📊'
    let title = evt.eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    if (evt.eventType === 'peak_update') {
      icon = '📈'
      title = `Peak Update: +${evt.peakGainPct.toFixed(1)}%`
    } else if (evt.eventType === 'trailing_trigger' || evt.eventType === 'trailing_stop') {
      icon = '🛡️'
    } else if (evt.eventType === 'stop_loss_trigger' || evt.eventType === 'stop_loss') {
      icon = '🛑'
    } else if (evt.eventType === 'take_profit_trigger' || evt.eventType === 'take_profit') {
      icon = '🎯'
    }

    timeline.push({
      type: evt.eventType,
      timestamp: evt.timestamp,
      title,
      icon,
      description: evt.triggerReason,
      details: evt.metadata,
      pnlPct: evt.pnlPct,
      peakGainPct: evt.peakGainPct,
      entryPrice: evt.entryPrice,
      currentPrice: evt.currentPrice,
      peakPrice: evt.peakPrice,
    })
  }

  // Exit event
  const exitPnlPct = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100
  timeline.push({
    type: 'exit',
    timestamp: trade.closedAt,
    title: `Position Closed: ${trade.symbol}`,
    description: `Sold ${trade.quantity.toFixed(4)} units @ ₹${trade.exitPrice.toFixed(2)}`,
    details: trade.exitDetails,
    pnlPct: exitPnlPct,
    pnl: trade.pnl,
    exitReason: trade.exitReason,
    maxFavorable: trade.maxFavorable,
    maxAdverse: trade.maxAdverse,
    holdDuration: trade.holdDuration,
  })

  return NextResponse.json({
    trade: {
      id: trade.id,
      symbol: trade.symbol,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnl: trade.pnl,
      pnlPct: exitPnlPct,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      exitReason: trade.exitReason,
      entryReason: trade.entryReason,
      maxFavorable: trade.maxFavorable,
      maxAdverse: trade.maxAdverse,
      holdDuration: trade.holdDuration,
    },
    timeline,
    eventCount: events.length,
  })
}

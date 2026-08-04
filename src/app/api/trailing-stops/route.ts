import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getMarketPrice } from '@/lib/trading'

/**
 * GET /api/trailing-stops
 * Returns active trailing stop tracking data for all open positions.
 */
export async function GET() {
  const positions = await prisma.position.findMany()

  const trailingStops = []
  for (const pos of positions) {
    try {
      const currentPrice = await getMarketPrice(pos.symbol)
      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
      const peakGainPct = pos.peakPrice > 0
        ? ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100
        : 0

      // Trailing stop level: 50% of peak gain (only active if peak > +5%)
      const isTrailingActive = peakGainPct >= 5
      const trailingStopLevel = isTrailingActive
        ? pos.entryPrice * (1 + peakGainPct * 0.005) // 50% of peak gain
        : null

      // How close to the trailing stop?
      const distanceToStop = trailingStopLevel
        ? ((currentPrice - trailingStopLevel) / currentPrice) * 100
        : null

      trailingStops.push({
        symbol: pos.symbol,
        entryPrice: pos.entryPrice,
        currentPrice,
        peakPrice: pos.peakPrice,
        pnlPct,
        peakGainPct,
        isTrailingActive,
        trailingStopLevel,
        distanceToStop,
        protectedGain: isTrailingActive ? peakGainPct * 0.5 : 0,
        quantity: pos.quantity,
        pnl: (currentPrice - pos.entryPrice) * pos.quantity,
        openedAt: pos.createdAt,
      })
    } catch {
      // Skip if price fetch fails
    }
  }

  // Sort by peak gain (most profit at risk first)
  trailingStops.sort((a, b) => b.peakGainPct - a.peakGainPct)

  return NextResponse.json({
    trailingStops,
    count: trailingStops.length,
    activeCount: trailingStops.filter(t => t.isTrailingActive).length,
  })
}

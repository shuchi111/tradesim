import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/strategy/autotrade/status
 * Returns the current auto-trade configuration + server-side loop status.
 */
export async function GET() {
  try {
    const config = await prisma.autoTradeConfig.findUnique({ where: { id: 1 } })

    // Determine if market is open (IST)
    const now = new Date()
    const istOffset = 5.5 * 60 // minutes
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
    const istMinutes = (utcMinutes + istOffset) % (24 * 60)
    const istDay = new Date(now.getTime() + istOffset * 60000).getUTCDay()
    const isWeekend = istDay === 0 || istDay === 6
    const marketOpen = !isWeekend && istMinutes >= 9 * 60 + 15 && istMinutes <= 15 * 60 + 30

    return NextResponse.json({
      data: {
        enabled: config?.enabled ?? false,
        serverSide: true,
        marketOpen,
        istTime: `${Math.floor(istMinutes / 60).toString().padStart(2, '0')}:${(istMinutes % 60).toString().padStart(2, '0')} IST`,
        updatedAt: config?.updatedAt ?? null,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/strategy/autotrade/status
 * Toggle auto-trade on/off. The server-side loop reads this from the DB.
 */
export async function PATCH() {
  try {
    const existing = await prisma.autoTradeConfig.findUnique({ where: { id: 1 } })
    const newEnabled = !(existing?.enabled ?? false)

    const config = await prisma.autoTradeConfig.upsert({
      where: { id: 1 },
      update: { enabled: newEnabled, updatedAt: new Date() },
      create: { id: 1, enabled: newEnabled },
    })

    return NextResponse.json({ data: { enabled: config.enabled } })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    )
  }
}

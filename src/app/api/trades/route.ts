import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const trades = await prisma.trade.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ data: trades })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch trades' }, { status: 500 })
  }
}

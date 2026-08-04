import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkPendingOrders } from '@/lib/trading'

export async function GET() {
  try {
    // Check pending limit orders before returning
    await checkPendingOrders()

    const positions = await prisma.position.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ data: positions })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 })
  }
}

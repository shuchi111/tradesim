import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { processMarketOrder, processLimitOrder, checkPendingOrders } from '@/lib/trading'

export async function GET() {
  try {
    // Check pending limit orders before returning
    await checkPendingOrders()

    const orders = await prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ data: orders })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { symbol, side, type, quantity, price } = body

    if (!symbol || !side || !type || !quantity) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (quantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be positive' }, { status: 400 })
    }

    if (type === 'market') {
      const result = await processMarketOrder(symbol, side, quantity)
      return NextResponse.json({ data: result })
    } else if (type === 'limit') {
      if (!price || price <= 0) {
        return NextResponse.json({ error: 'Limit price required' }, { status: 400 })
      }
      const result = await processLimitOrder(symbol, side, quantity, price)
      return NextResponse.json({ data: result })
    } else {
      return NextResponse.json({ error: 'Invalid order type' }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to place order'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

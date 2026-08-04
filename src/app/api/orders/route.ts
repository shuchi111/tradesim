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

    if (!symbol || !side || !type || quantity == null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: 'Quantity must be positive' }, { status: 400 })
    }
    if (!Number.isInteger(qty)) {
      return NextResponse.json(
        { error: 'Fractional quantities are not allowed — use whole shares only' },
        { status: 400 }
      )
    }

    if (type === 'market') {
      const result = await processMarketOrder(symbol, side, qty)
      return NextResponse.json({ data: result })
    } else if (type === 'limit') {
      if (!price || price <= 0) {
        return NextResponse.json({ error: 'Limit price required' }, { status: 400 })
      }
      const result = await processLimitOrder(symbol, side, qty, price)
      return NextResponse.json({ data: result })
    } else {
      return NextResponse.json({ error: 'Invalid order type' }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to place order'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const order = await prisma.order.findUnique({ where: { id: parseInt(id) } })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (order.status !== 'pending') {
      return NextResponse.json({ error: 'Cannot cancel non-pending order' }, { status: 400 })
    }

    await prisma.order.update({
      where: { id: parseInt(id) },
      data: { status: 'cancelled' },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to cancel order' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/notifications
 * Returns recent notifications, optionally filtered by unread.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === 'true'
  const limit = parseInt(searchParams.get('limit') || '50')

  const notifications = await prisma.notification.findMany({
    where: unreadOnly ? { isRead: false } : undefined,
    take: limit,
    orderBy: { createdAt: 'desc' },
  })

  const unreadCount = await prisma.notification.count({
    where: { isRead: false },
  })

  return NextResponse.json({
    notifications,
    unreadCount,
  })
}

/**
 * POST /api/notifications
 * Mark notifications as read.
 */
export async function POST(request: Request) {
  const body = await request.json()
  const { action, id } = body

  if (action === 'mark_all_read') {
    await prisma.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    })
    return NextResponse.json({ success: true, message: 'All marked as read' })
  }

  if (action === 'mark_read' && id) {
    await prisma.notification.update({
      where: { id: parseInt(id) },
      data: { isRead: true },
    })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

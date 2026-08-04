import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { toHistoryItem } from '@/lib/agent-analysis'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)
  const ticker = searchParams.get('ticker')

  const rows = await prisma.agentAnalysis.findMany({
    where: {
      status: 'completed',
      ...(ticker ? { ticker } : {}),
    },
    orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })

  return NextResponse.json({
    history: rows.map(toHistoryItem),
    source: 'database',
  })
}

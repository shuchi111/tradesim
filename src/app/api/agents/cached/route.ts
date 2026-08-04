import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { toAnalysisResult, todayTradeDate } from '@/lib/agent-analysis'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ticker = searchParams.get('ticker')
  const tradeDate = searchParams.get('trade_date') || todayTradeDate()

  if (!ticker) {
    return NextResponse.json({ error: 'ticker parameter required' }, { status: 400 })
  }

  const row = await prisma.agentAnalysis.findUnique({
    where: { ticker_tradeDate: { ticker, tradeDate } },
  })

  if (!row || row.status !== 'completed') {
    return NextResponse.json({ cached: false, result: null }, { status: 404 })
  }

  return NextResponse.json({
    cached: true,
    id: row.id,
    result: toAnalysisResult(row),
  })
}

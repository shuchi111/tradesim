import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  SCANNER_URL,
  persistCompletedAnalysis,
  toAnalysisResult,
} from '@/lib/agent-analysis'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  const existing = await prisma.agentAnalysis.findUnique({
    where: { taskId },
  })

  if (existing?.status === 'completed' && existing.agentReports) {
    return NextResponse.json({
      task_id: taskId,
      status: 'completed',
      ticker: existing.ticker,
      trade_date: existing.tradeDate,
      progress: existing.progress ?? 'Done',
      result: toAnalysisResult(existing),
      source: 'database',
    })
  }

  try {
    const resp = await fetch(`${SCANNER_URL}/api/agents/status/${encodeURIComponent(taskId)}`, {
      cache: 'no-store',
    })
    const data = await resp.json()

    if (!resp.ok) {
      return NextResponse.json(data, { status: resp.status })
    }

    if (data.status === 'completed' && data.result) {
      await persistCompletedAnalysis(taskId, data.result)
    } else if (data.status === 'failed') {
      await prisma.agentAnalysis.updateMany({
        where: { taskId },
        data: {
          status: 'failed',
          error: data.error ?? 'Analysis failed',
          progress: data.progress ?? 'Error',
        },
      })
    } else {
      await prisma.agentAnalysis.updateMany({
        where: { taskId },
        data: {
          status: data.status ?? 'running',
          progress: data.progress ?? '',
        },
      })
    }

    return NextResponse.json(data)
  } catch {
    if (existing) {
      return NextResponse.json({
        task_id: taskId,
        status: existing.status,
        ticker: existing.ticker,
        trade_date: existing.tradeDate,
        progress: existing.progress ?? '',
        error: existing.error,
      })
    }
    return NextResponse.json(
      { error: 'Scanner unavailable. Start it with: npm run scanner' },
      { status: 503 }
    )
  }
}

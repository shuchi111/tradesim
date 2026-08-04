import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  SCANNER_URL,
  toAnalysisResult,
  todayTradeDate,
} from '@/lib/agent-analysis'

async function startScannerAnalysis(ticker: string, tradeDate: string) {
  const url = `${SCANNER_URL}/api/agents/analyze?ticker=${encodeURIComponent(ticker)}&trade_date=${encodeURIComponent(tradeDate)}`
  const resp = await fetch(url, { cache: 'no-store' })
  const text = await resp.text()

  let data: { task_id?: string; detail?: string; message?: string } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(
      resp.ok
        ? 'Scanner returned invalid JSON'
        : `Scanner unavailable (${resp.status}). Start it with: npm run scanner`
    )
  }

  if (!resp.ok) {
    throw new Error(data.detail || data.message || `Scanner error (${resp.status})`)
  }

  if (!data.task_id) {
    throw new Error('Scanner did not return a task id')
  }

  return data.task_id
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ticker = searchParams.get('ticker')
  const force = searchParams.get('force') === 'true'
  const tradeDate = searchParams.get('trade_date') || todayTradeDate()

  if (!ticker) {
    return NextResponse.json({ error: 'ticker parameter required' }, { status: 400 })
  }

  if (!force) {
    const cached = await prisma.agentAnalysis.findUnique({
      where: { ticker_tradeDate: { ticker, tradeDate } },
    })
    if (cached?.status === 'completed') {
      return NextResponse.json({
        cached: true,
        id: cached.id,
        status: 'completed',
        result: toAnalysisResult(cached),
      })
    }
  }

  try {
    const taskId = await startScannerAnalysis(ticker, tradeDate)

    await prisma.agentAnalysis.upsert({
      where: { ticker_tradeDate: { ticker, tradeDate } },
      create: {
        taskId,
        ticker,
        tradeDate,
        status: 'queued',
        progress: 'Queued...',
        startedAt: new Date(),
      },
      update: {
        taskId,
        status: 'queued',
        progress: 'Queued...',
        error: null,
        signal: null,
        confidence: null,
        sizeFraction: null,
        targetPrice: null,
        stopLoss: null,
        finalTradeDecision: null,
        agentReports: Prisma.JsonNull,
        recommendation: Prisma.JsonNull,
        completedAt: null,
        startedAt: new Date(),
      },
    })

    return NextResponse.json({
      cached: false,
      task_id: taskId,
      ticker,
      status: 'queued',
      message: 'Analysis started. Poll /api/agents/status/{task_id} for results.',
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Analysis failed'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const ticker = body.ticker as string | undefined
  const force = body.force === true
  const tradeDate = (body.trade_date as string | undefined) || todayTradeDate()

  if (!ticker) {
    return NextResponse.json({ error: 'ticker parameter required' }, { status: 400 })
  }

  const url = new URL(request.url)
  url.searchParams.set('ticker', ticker)
  url.searchParams.set('trade_date', tradeDate)
  if (force) url.searchParams.set('force', 'true')

  return GET(new Request(url.toString(), { method: 'GET' }))
}

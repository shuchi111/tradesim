import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateDailyReport } from '@/lib/reports/daily-report'

/**
 * GET /api/reports
 * List all daily reports.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '30')

  const reports = await prisma.dailyReport.findMany({
    take: limit,
    orderBy: { reportDate: 'desc' },
  })

  return NextResponse.json({
    reports: reports.map(r => ({
      id: r.id,
      reportDate: r.reportDate,
      startingEquity: r.startingEquity,
      endingEquity: r.endingEquity,
      dailyPnl: r.dailyPnl,
      dailyPnlPct: r.dailyPnlPct,
      tradesCount: r.tradesCount,
      winRate: r.winRate,
      summary: r.summary,
      metrics: r.metrics,
    })),
    count: reports.length,
  })
}

/**
 * POST /api/reports
 * Manually trigger a daily report generation.
 */
export async function POST() {
  try {
    const report = await generateDailyReport(new Date())
    return NextResponse.json({ success: true, report })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

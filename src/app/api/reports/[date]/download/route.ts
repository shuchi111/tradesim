import { NextResponse } from 'next/server'
import { reportToCsv, reportToHtml } from '@/lib/reports/daily-report'
import { isValidReportDateKey } from '@/lib/report-date-utils'
import { findReportByDateKey } from '@/lib/report-queries'

/**
 * GET /api/reports/[date]/download?format=pdf|csv
 * Download a daily report as PDF (HTML for print) or CSV.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'csv'

  if (!isValidReportDateKey(date)) {
    return NextResponse.json({ error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 })
  }

  const report = await findReportByDateKey(date)

  if (!report) {
    return NextResponse.json({ error: 'Report not found for this date' }, { status: 404 })
  }

  const reportData = {
    reportDate: report.reportDate,
    startingEquity: report.startingEquity,
    endingEquity: report.endingEquity,
    dailyPnl: report.dailyPnl,
    dailyPnlPct: report.dailyPnlPct,
    tradesCount: report.tradesCount,
    winRate: report.winRate,
    metrics: report.metrics as Record<string, number>,
    tradesData: report.tradesData as Record<string, unknown>[],
    riskEvents: report.riskEvents as Record<string, unknown>[],
    summary: report.summary ?? '',
    topWinners: (report.topWinners ?? []) as Record<string, unknown>[],
    topLosers: (report.topLosers ?? []) as Record<string, unknown>[],
    openPositions: (report.openPositions ?? []) as Record<string, unknown>[],
    agentAnalyses: [] as Record<string, unknown>[],
    scannerPicks: [] as Record<string, unknown>[],
  }

  if (format === 'csv') {
    const csv = reportToCsv(reportData)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="tradesim-report-${date}.csv"`,
      },
    })
  }

  // PDF format — return print-ready HTML (browser's print-to-PDF)
  const html = reportToHtml(reportData)
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Content-Disposition': `inline; filename="tradesim-report-${date}.html"`,
    },
  })
}

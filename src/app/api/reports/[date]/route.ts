import { NextResponse } from 'next/server'
import { isValidReportDateKey } from '@/lib/report-date-utils'
import { findReportByDateKey } from '@/lib/report-queries'

/**
 * GET /api/reports/[date]
 * Get a specific daily report by date (YYYY-MM-DD).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params

  if (!isValidReportDateKey(date)) {
    return NextResponse.json({ error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 })
  }

  const report = await findReportByDateKey(date)

  if (!report) {
    return NextResponse.json({ error: 'Report not found for this date' }, { status: 404 })
  }

  return NextResponse.json(report)
}

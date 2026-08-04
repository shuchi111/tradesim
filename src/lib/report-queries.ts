import { prisma } from '@/lib/prisma'
import { reportDateFromKey, toReportDateKey } from '@/lib/report-date-utils'

/** Find report by IST calendar day, with fallback for legacy stored timestamps */
export async function findReportByDateKey(key: string) {
  const dayStart = reportDateFromKey(key)

  const exact = await prisma.dailyReport.findUnique({
    where: { reportDate: dayStart },
  })
  if (exact) return exact

  const reports = await prisma.dailyReport.findMany({
    take: 100,
    orderBy: { reportDate: 'desc' },
  })
  return reports.find((r) => toReportDateKey(r.reportDate) === key) ?? null
}

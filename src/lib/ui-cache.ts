import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const SCANNER_URL = process.env.SCANNER_INTERNAL_URL || 'http://localhost:8000'
export const FORECAST_TTL_HOURS = 36

export function formatCachedAt(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }) + ' IST'
}

export async function getCachedForecast(
  symbol: string,
  horizon: number,
  interval: string
) {
  const row = await prisma.forecastCache.findUnique({
    where: { symbol_horizon_interval: { symbol, horizon, interval } },
  })
  if (!row) return null
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null
  return row
}

export async function saveForecastCache(params: {
  symbol: string
  horizon: number
  interval: string
  sampleCount: number
  forecast: Prisma.InputJsonValue
}) {
  const expiresAt = new Date(Date.now() + FORECAST_TTL_HOURS * 60 * 60 * 1000)
  return prisma.forecastCache.upsert({
    where: {
      symbol_horizon_interval: {
        symbol: params.symbol,
        horizon: params.horizon,
        interval: params.interval,
      },
    },
    create: {
      symbol: params.symbol,
      horizon: params.horizon,
      interval: params.interval,
      sampleCount: params.sampleCount,
      forecast: params.forecast,
      generatedAt: new Date(),
      expiresAt,
    },
    update: {
      sampleCount: params.sampleCount,
      forecast: params.forecast,
      generatedAt: new Date(),
      expiresAt,
    },
  })
}

export async function getLatestScannerScan() {
  return prisma.scannerScan.findFirst({
    orderBy: { createdAt: 'desc' },
  })
}

export async function saveScannerScan(data: {
  scanDate: Date
  scanDateKey?: string
  regime?: string | null
  vix?: number | null
  picks: Prisma.InputJsonValue
  methodStats?: Prisma.InputJsonValue
  rawResult?: Prisma.InputJsonValue
}) {
  return prisma.scannerScan.create({
    data: {
      scanDate: data.scanDate,
      scanDateKey: data.scanDateKey ?? null,
      regime: data.regime ?? null,
      vix: data.vix ?? null,
      picks: data.picks,
      methodStats: data.methodStats ?? Prisma.JsonNull,
      rawResult: data.rawResult ?? Prisma.JsonNull,
    },
  })
}

export async function listScannerScans(limit = 30) {
  return prisma.scannerScan.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

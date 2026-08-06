import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const SCANNER_URL =
  process.env.SCANNER_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_SCANNER_URL ||
  `http://localhost:${process.env.SCANNER_PORT || '8000'}`

export const FORECAST_TTL_HOURS = 36

/** Yahoo-style symbol used by Kronos cache (e.g. RELIANCE.NS). */
export function toYahooSymbol(symbol: string): string {
  const s = symbol.trim()
  if (!s) return s
  const upper = s.toUpperCase()
  if (upper === 'NIFTY50' || upper.includes('NSEI') || s.startsWith('^')) {
    return s.startsWith('%') ? decodeURIComponent(s) : s.startsWith('^') ? s : '^NSEI'
  }
  if (s.includes('.')) return s
  return `${s}.NS`
}

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

/** Latest non-expired cache row for a symbol (any horizon), preferring exact horizon. */
export async function getLatestCachedForecast(symbol: string, horizon?: number, interval = '1d') {
  const yahoo = toYahooSymbol(symbol)
  if (horizon != null) {
    const exact = await getCachedForecast(yahoo, horizon, interval)
    if (exact) return exact
  }
  const rows = await prisma.forecastCache.findMany({
    where: { symbol: yahoo, interval },
    orderBy: { generatedAt: 'desc' },
    take: 5,
  })
  const now = Date.now()
  return rows.find((r) => !r.expiresAt || r.expiresAt.getTime() >= now) ?? null
}

export type KronosSummary = {
  symbol: string
  direction: string
  confidence_pct: number
  upside_probability: number
  volatility_amplification: number
  predicted_change_pct: number
  current_price: number
  forecast_final_price: number
  horizon: number
  created_at: string
  full_forecast?: unknown
}

function summaryFromForecastJson(
  symbol: string,
  forecast: unknown,
  generatedAt: Date,
  horizonFallback: number
): KronosSummary | null {
  if (!forecast || typeof forecast !== 'object') return null
  const f = forecast as Record<string, unknown>
  const meta = (f.metadata && typeof f.metadata === 'object'
    ? f.metadata
    : f) as Record<string, unknown>

  return {
    symbol,
    direction: String(meta.direction ?? 'neutral'),
    confidence_pct: Number(meta.confidence_pct ?? 0),
    upside_probability: Number(meta.upside_probability ?? 50),
    volatility_amplification: Number(meta.volatility_amplification ?? 50),
    predicted_change_pct: Number(meta.predicted_change_pct ?? 0),
    current_price: Number(meta.current_price ?? 0),
    forecast_final_price: Number(meta.forecast_final_price ?? 0),
    horizon: Number(f.horizon ?? meta.horizon ?? horizonFallback),
    created_at: generatedAt.toISOString(),
    full_forecast: f.historical ? f : undefined,
  }
}

/**
 * Resolve Kronos summary for strategy / AI score.
 * Prefer Turso ForecastCache, then live scanner `/api/forecast/cached/...`.
 */
export async function resolveKronosSummary(symbol: string): Promise<KronosSummary | null> {
  const yahoo = toYahooSymbol(symbol)

  try {
    const row = await getLatestCachedForecast(yahoo, 10, '1d')
    if (row) {
      const fromDb = summaryFromForecastJson(yahoo, row.forecast, row.generatedAt, row.horizon)
      if (fromDb) return fromDb
    }
  } catch {
    // DB unavailable — fall through to scanner
  }

  try {
    const base = SCANNER_URL.replace(/\/$/, '')
    const res = await fetch(
      `${base}/api/forecast/cached/${encodeURIComponent(yahoo)}`,
      { signal: AbortSignal.timeout(3000), cache: 'no-store' }
    )
    if (!res.ok) return null
    return (await res.json()) as KronosSummary
  } catch {
    return null
  }
}

export async function saveForecastCache(params: {
  symbol: string
  horizon: number
  interval: string
  sampleCount: number
  forecast: Prisma.InputJsonValue
  generatedAt?: Date
}) {
  const expiresAt = new Date(Date.now() + FORECAST_TTL_HOURS * 60 * 60 * 1000)
  const generatedAt = params.generatedAt ?? new Date()
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
      generatedAt,
      expiresAt,
    },
    update: {
      sampleCount: params.sampleCount,
      forecast: params.forecast,
      generatedAt,
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

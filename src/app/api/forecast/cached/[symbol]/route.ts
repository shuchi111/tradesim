import { NextRequest, NextResponse } from 'next/server'
import {
  SCANNER_URL,
  formatCachedAt,
  getLatestCachedForecast,
  toYahooSymbol,
} from '@/lib/ui-cache'

/**
 * GET /api/forecast/cached/[symbol]?horizon=10&interval=1d
 * Returns the full Kronos forecast payload for the UI (Turso first, scanner fallback).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol: raw } = await params
    const symbol = toYahooSymbol(decodeURIComponent(raw))
    const horizon = Number(req.nextUrl.searchParams.get('horizon') || '10')
    const interval = req.nextUrl.searchParams.get('interval') || '1d'

    const row = await getLatestCachedForecast(symbol, horizon, interval)
    if (row) {
      const forecast = row.forecast as Record<string, unknown>
      // Stored value may be the full ForecastResponse or a wrapper with full_forecast
      const payload =
        forecast && typeof forecast === 'object' && Array.isArray(forecast.historical)
          ? forecast
          : forecast?.full_forecast && typeof forecast.full_forecast === 'object'
            ? (forecast.full_forecast as Record<string, unknown>)
            : null

      if (payload && Array.isArray(payload.historical)) {
        return NextResponse.json({
          ...payload,
          cached: true,
          cached_at: row.generatedAt.toISOString(),
          cached_at_display: formatCachedAt(row.generatedAt),
          source: 'turso',
        })
      }

      // Summary-only row — still useful for AI Score / strategy consumers
      return NextResponse.json({
        symbol: row.symbol,
        horizon: row.horizon,
        interval: row.interval,
        ...(typeof forecast === 'object' ? forecast : {}),
        cached: true,
        cached_at: row.generatedAt.toISOString(),
        cached_at_display: formatCachedAt(row.generatedAt),
        source: 'turso',
      })
    }

    // Fallback: live scanner SQLite cache
    const base = SCANNER_URL.replace(/\/$/, '')
    const res = await fetch(
      `${base}/api/forecast/cached/${encodeURIComponent(symbol)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) {
      return NextResponse.json(
        { error: `No cached forecast for ${symbol}` },
        { status: 404 }
      )
    }
    const data = await res.json()
    const full = data.full_forecast
    if (full && typeof full === 'object' && Array.isArray(full.historical)) {
      return NextResponse.json({
        ...full,
        cached: true,
        cached_at: data.created_at,
        cached_at_display: formatCachedAt(data.created_at),
        source: 'scanner',
      })
    }
    return NextResponse.json({
      ...data,
      cached: true,
      cached_at: data.created_at,
      cached_at_display: formatCachedAt(data.created_at),
      source: 'scanner',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { INSTRUMENTS } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ForecastCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  p5_close: number
  p10_close: number
  p25_close: number
  p75_close: number
  p90_close: number
  p95_close: number
}

interface HistoricalCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface ForecastMetadata {
  current_price: number
  forecast_final_price: number
  predicted_change_pct: number
  direction: string
  confidence_pct: number
  upside_probability: number
  volatility_amplification: number
  sample_count: number
  lookback_used: number
  predict_time_ms: number
  total_time_ms: number
  model: string
  interval: string
}

interface PathPoint {
  time: number
  value: number
}

interface ForecastResponse {
  symbol: string
  horizon: number
  interval: string
  historical: HistoricalCandle[]
  forecast: ForecastCandle[]
  sample_paths?: PathPoint[][]
  metadata: ForecastMetadata
  cached?: boolean
  cached_at?: string
  cached_at_display?: string
  source?: string
}

const HORIZON_OPTIONS_DAILY = [5, 10, 20]
const HORIZON_HOURLY = 24
const DISPLAY_LOOKBACK = 120

type ViewMode = 'candles' | 'probabilistic'
type IntervalMode = '1d' | '1h'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ForecastTab({
  symbol: initialSymbol,
  refreshKey = 0,
}: {
  symbol: string
  refreshKey?: number
}) {
  // Prefer a cacheable equity when header is on NIFTY50 (Kronos cron caches .NS stocks)
  const defaultSymbol =
    initialSymbol === 'NIFTY50'
      ? (INSTRUMENTS.find((i) => i.currency === 'INR' && i.symbol !== 'NIFTY50')?.symbol || initialSymbol)
      : initialSymbol

  const [symbol, setSymbol] = useState(defaultSymbol)
  const [horizon, setHorizon] = useState(10)
  const [interval, setInterval] = useState<IntervalMode>('1d')
  const [viewMode, setViewMode] = useState<ViewMode>('probabilistic')
  const [loading, setLoading] = useState(false)
  const [loadingCached, setLoadingCached] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [cacheLabel, setCacheLabel] = useState<string | null>(null)

  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // Candle view refs
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const forecastSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const p10SeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const p90SeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  // Probabilistic view refs
  const histLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const medianLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const upperBandRef = useRef<ISeriesApi<'Area'> | null>(null)
  const lowerBandRef = useRef<ISeriesApi<'Area'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const pathSeriesRefs = useRef<ISeriesApi<'Line'>[]>([])

  // --- Chart initialization (once) ---
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 480,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e17' },
        textColor: '#8a9bb4',
      },
      grid: {
        vertLines: { color: 'rgba(42, 52, 71, 0.3)' },
        horzLines: { color: 'rgba(42, 52, 71, 0.3)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a3447' },
      timeScale: {
        borderColor: '#2a3447',
        timeVisible: false,
        secondsVisible: false,
      },
    })
    chartRef.current = chart

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (chartRef.current) {
          chartRef.current.applyOptions({ width: entry.contentRect.width })
        }
      }
    })
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // --- Build chart series based on view mode ---
  const buildSeries = useCallback((mode: ViewMode) => {
    const chart = chartRef.current
    if (!chart) return

    // Remove all existing series by type-checking each ref
    const allRefs: React.MutableRefObject<ISeriesApi<any> | null>[] = [
      candleSeriesRef, forecastSeriesRef, p10SeriesRef, p90SeriesRef,
      histLineRef, medianLineRef, upperBandRef, lowerBandRef, volumeSeriesRef,
    ]
    for (const ref of allRefs) {
      if (ref.current) {
        try { chart.removeSeries(ref.current) } catch { /* already removed */ }
        ref.current = null
      }
    }
    // Remove path series
    for (const ps of pathSeriesRefs.current) {
      try { chart.removeSeries(ps) } catch { /* already removed */ }
    }
    pathSeriesRefs.current = []

    if (mode === 'candles') {
      // Historical candles — solid green/red
      candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a', downColor: '#ef5350',
        borderUpColor: '#26a69a', borderDownColor: '#ef5350',
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      })
      // Forecast candles — semi-transparent blue/orange
      forecastSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: 'rgba(96, 165, 250, 0.7)', downColor: 'rgba(251, 146, 60, 0.7)',
        borderUpColor: 'rgba(96, 165, 250, 0.9)', borderDownColor: 'rgba(251, 146, 60, 0.9)',
        wickUpColor: 'rgba(96, 165, 250, 0.5)', wickDownColor: 'rgba(251, 146, 60, 0.5)',
      })
      // Confidence bands
      p10SeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: 'rgba(96, 165, 250, 0)', topColor: 'rgba(96, 165, 250, 0.1)',
        bottomColor: 'rgba(96, 165, 250, 0)', lineWidth: 1, priceScaleId: 'right',
      })
      p90SeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: 'rgba(96, 165, 250, 0)', topColor: 'rgba(96, 165, 250, 0.12)',
        bottomColor: 'rgba(96, 165, 250, 0)', lineWidth: 1, priceScaleId: 'right',
      })
    } else {
      // === Probabilistic view ===
      // Historical price — blue line
      histLineRef.current = chart.addSeries(LineSeries, {
        color: '#3b82f6', lineWidth: 2, priceScaleId: 'right',
      })
      // Individual sample paths — thin semi-transparent orange lines (Monte Carlo fan)
      if (data) {
        const paths = data.sample_paths || []
        for (let i = 0; i < paths.length; i++) {
          const pathSeries = chart.addSeries(LineSeries, {
            color: 'rgba(251, 146, 60, 0.18)',
            lineWidth: 1,
            priceScaleId: 'right',
            lastValueVisible: false,
            priceLineVisible: false,
          })
          pathSeriesRefs.current.push(pathSeries)
        }
      }
      // Forecast median — solid orange line
      medianLineRef.current = chart.addSeries(LineSeries, {
        color: '#f97316', lineWidth: 3, priceScaleId: 'right',
      })
      // Confidence band p95 upper — shaded orange area
      upperBandRef.current = chart.addSeries(AreaSeries, {
        lineColor: 'rgba(251, 146, 60, 0.3)',
        topColor: 'rgba(251, 146, 60, 0.15)',
        bottomColor: 'rgba(251, 146, 60, 0)',
        lineWidth: 1, priceScaleId: 'right',
      })
      // Confidence band p5 lower — same color to fill the gap
      lowerBandRef.current = chart.addSeries(AreaSeries, {
        lineColor: 'rgba(251, 146, 60, 0.3)',
        topColor: 'rgba(251, 146, 60, 0)',
        bottomColor: 'rgba(251, 146, 60, 0.15)',
        lineWidth: 1, priceScaleId: 'right',
      })
    }
  }, [data])

  // --- Populate chart data ---
  const populateChart = useCallback((d: ForecastResponse, mode: ViewMode) => {
    const histSlice = d.historical.slice(-DISPLAY_LOOKBACK)

    if (mode === 'candles') {
      candleSeriesRef.current?.setData(
        histSlice.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close }))
      )
      forecastSeriesRef.current?.setData(
        d.forecast.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close }))
      )
      p10SeriesRef.current?.setData(
        d.forecast.map((k) => ({ time: k.time as UTCTimestamp, value: k.p10_close }))
      )
      p90SeriesRef.current?.setData(
        d.forecast.map((k) => ({ time: k.time as UTCTimestamp, value: k.p90_close }))
      )
    } else {
      // === Probabilistic view ===
      // Historical line (blue)
      histLineRef.current?.setData(
        histSlice.map((k) => ({ time: k.time as UTCTimestamp, value: k.close }))
      )
      // Sample paths (Monte Carlo fan)
      const paths = d.sample_paths || []
      pathSeriesRefs.current.forEach((series, i) => {
        if (paths[i]) {
          series.setData(
            paths[i].map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
          )
        }
      })
      // Forecast median (orange)
      medianLineRef.current?.setData(
        d.forecast.map((k) => ({ time: k.time as UTCTimestamp, value: k.close }))
      )
      // Confidence band p5/p95
      upperBandRef.current?.setData(
        d.forecast.map((k) => ({ time: k.time as UTCTimestamp, value: k.p95_close }))
      )
      lowerBandRef.current?.setData(
        d.forecast.map((k) => ({ time: k.time as UTCTimestamp, value: k.p5_close }))
      )
    }
    chartRef.current?.timeScale().fitContent()
  }, [])

  // --- Rebuild series when view mode changes ---
  useEffect(() => {
    if (data) {
      buildSeries(viewMode)
      populateChart(data, viewMode)
    }
  }, [viewMode, data, buildSeries, populateChart])

  const yahooForSymbol = useCallback((sym: string) => {
    const instrument = INSTRUMENTS.find((i) => i.symbol === sym)
    return instrument?.yahooSymbol || sym
  }, [])

  /** Auto-load morning Kronos cache (Turso / scanner) — no live model run. */
  const loadCachedForecast = useCallback(async () => {
    setLoadingCached(true)
    setError(null)

    const yahooSymbol = yahooForSymbol(symbol)
    const h = interval === '1h' ? HORIZON_HOURLY : horizon
    const params = new URLSearchParams({
      horizon: String(h),
      interval,
    })

    try {
      const pathSymbol = encodeURIComponent(decodeURIComponent(yahooSymbol))
      const res = await fetch(`/api/forecast/cached/${pathSymbol}?${params}`)
      if (!res.ok) {
        setData(null)
        setCacheLabel(null)
        return
      }
      const json = (await res.json()) as ForecastResponse
      if (!json.historical || !json.forecast || !json.metadata) {
        setData(null)
        setCacheLabel(null)
        return
      }
      setData({
        ...json,
        sample_paths: Array.isArray(json.sample_paths) ? json.sample_paths : [],
      })
      setCacheLabel(
        json.cached_at_display
          ? `Cached · ${json.cached_at_display}`
          : json.cached
            ? 'Cached forecast'
            : null
      )
    } catch {
      setData(null)
      setCacheLabel(null)
    } finally {
      setLoadingCached(false)
    }
  }, [symbol, horizon, interval, yahooForSymbol])

  // Auto-load cache on mount, symbol/horizon change, and after cron refreshKey
  useEffect(() => {
    loadCachedForecast()
  }, [loadCachedForecast, refreshKey])

  // Sync header symbol when parent changes (skip NIFTY50 → keep equity default)
  useEffect(() => {
    if (initialSymbol && initialSymbol !== 'NIFTY50') {
      setSymbol(initialSymbol)
    }
  }, [initialSymbol])

  // --- Live forecast (Generate / Regenerate) ---
  const runForecast = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCacheLabel(null)

    const yahooSymbol = yahooForSymbol(symbol)

    try {
      const params = new URLSearchParams({ sample_count: '5' })
      if (interval === '1h') {
        params.set('horizon', String(HORIZON_HOURLY))
        params.set('interval', '1h')
      } else {
        params.set('horizon', String(horizon))
        params.set('interval', '1d')
      }
      const scannerBase = (process.env.NEXT_PUBLIC_SCANNER_URL || 'http://localhost:8000').replace(/\/$/, '')
      const pathSymbol = encodeURIComponent(decodeURIComponent(yahooSymbol))
      const res = await fetch(`${scannerBase}/api/forecast/${pathSymbol}?${params}`)
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { detail?: unknown }
        const detail = errBody.detail
        const message =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d) => (typeof d === 'object' && d && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d))).join('; ')
              : `Server returned ${res.status}`
        throw new Error(message)
      }
      const json: ForecastResponse = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Forecast failed')
    } finally {
      setLoading(false)
    }
  }, [symbol, horizon, interval, yahooForSymbol])

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const directionColor =
    data?.metadata.direction === 'bullish' ? 'text-green-400' :
    data?.metadata.direction === 'bearish' ? 'text-red-400' : 'text-gray-400'

  const directionIcon =
    data?.metadata.direction === 'bullish' ? '📈' :
    data?.metadata.direction === 'bearish' ? '📉' : '➡️'

  // Upside probability color: green if >50%, red if <50%
  const upsideColor =
    (data?.metadata.upside_probability ?? 50) > 50 ? 'text-green-400' : 'text-red-400'

  // Volatility color: amber if >50% (increased vol expected)
  const volColor =
    (data?.metadata.volatility_amplification ?? 50) > 50 ? 'text-amber-400' : 'text-blue-400'

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">🔮 AI Price Forecast</h2>
          <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400">
            Kronos-small · Foundation Model
          </span>
        </div>

        {/* View toggle */}
        {data && (
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1">
            <button
              onClick={() => setViewMode('probabilistic')}
              className={`rounded px-3 py-1 text-sm ${
                viewMode === 'probabilistic' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              📊 Probabilistic
            </button>
            <button
              onClick={() => setViewMode('candles')}
              className={`rounded px-3 py-1 text-sm ${
                viewMode === 'candles' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              🕯️ Candles
            </button>
          </div>
        )}
      </div>

      {/* Probabilistic metric cards (Kronos-demo style) — only in probabilistic view */}
      {data && !loading && viewMode === 'probabilistic' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <div className="text-sm text-slate-400">
              Upside Probability (Next {data.horizon}{data.interval === '1h' ? 'h' : 'd'})
            </div>
            <div className={`mt-1 text-4xl font-bold ${upsideColor}`}>
              {data.metadata.upside_probability}%
            </div>
            <div className="mt-1 text-xs text-slate-500">
              The model&apos;s confidence that the price in {data.horizon} {data.interval === '1h' ? 'hours' : 'days'} will be higher than the last known price.
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <div className="text-sm text-slate-400">
              Volatility Amplification (Next {data.horizon}{data.interval === '1h' ? 'h' : 'd'})
            </div>
            <div className={`mt-1 text-4xl font-bold ${volColor}`}>
              {data.metadata.volatility_amplification}%
            </div>
            <div className="mt-1 text-xs text-slate-500">
              The probability that predicted volatility over the next {data.horizon} {data.interval === '1h' ? 'hours' : 'days'} will exceed recent historical volatility.
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        >
          {INSTRUMENTS.map((inst) => (
            <option key={inst.symbol} value={inst.symbol}>
              {inst.label} ({inst.symbol})
            </option>
          ))}
        </select>

        {/* Interval toggle: Daily (days) vs Hourly (24h) */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1">
          <button
            onClick={() => { setInterval('1d'); setHorizon(10) }}
            className={`rounded px-3 py-1 text-sm ${
              interval === '1d' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            📅 Daily
          </button>
          <button
            onClick={() => { setInterval('1h'); setHorizon(HORIZON_HOURLY) }}
            className={`rounded px-3 py-1 text-sm ${
              interval === '1h' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            ⏱️ 24h
          </button>
        </div>

        {/* Horizon selector (only for daily mode) */}
        {interval === '1d' && (
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1">
            <span className="px-2 text-xs text-slate-400">Horizon:</span>
            {HORIZON_OPTIONS_DAILY.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`rounded px-3 py-1 text-sm ${
                  horizon === h ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {h}d
              </button>
            ))}
          </div>
        )}

        <button
          onClick={runForecast}
          disabled={loading || loadingCached}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Generating...' : data ? 'Regenerate' : 'Generate Forecast'}
        </button>

        {cacheLabel && !loading && (
          <span className="rounded bg-emerald-900/40 px-2 py-1 text-xs text-emerald-400">
            {cacheLabel}
          </span>
        )}

        {!data && !loading && !loadingCached && !error && (
          <span className="text-xs text-slate-500">
            No cached forecast — run cron or click Generate
          </span>
        )}

        {data && viewMode === 'probabilistic' && (
          <span className="ml-auto text-xs text-slate-500">
            {data.metadata.sample_count} Monte Carlo paths
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="relative h-[480px] w-full shrink-0">
        <div ref={chartContainerRef} className="h-full w-full rounded-lg border border-slate-800" />

        {/* Legend overlay for probabilistic view */}
        {data && !loading && !loadingCached && viewMode === 'probabilistic' && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-900/80 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-4" style={{ background: '#3b82f6' }} />
              <span className="text-slate-300">Historical Price</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-block h-0.5 w-4" style={{ background: '#f97316' }} />
              <span className="text-slate-300">Forecast (median)</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-block h-2 w-4" style={{ background: 'rgba(251, 146, 60, 0.2)' }} />
              <span className="text-slate-300">Uncertainty Range (P5–P95)</span>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {(loading || loadingCached) && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-700 bg-slate-900/95 p-6 text-center shadow-2xl">
            <div className="mb-2 text-3xl">🔮</div>
            <div className="mb-1 font-medium text-white">
              {loading
                ? (data ? 'Generating new forecast...' : 'Loading AI model...')
                : 'Loading cached forecast...'}
            </div>
            <div className="text-xs text-slate-400">
              {loading
                ? (data
                  ? `Running ${data.horizon}-${data.interval === '1h' ? 'hour' : 'day'} forecast with 5 Monte Carlo paths`
                  : 'First run downloads model weights (~100MB). This takes 10-30s.')
                : 'From morning Kronos cron (Turso cache)'}
            </div>
            <div className="mt-3 inline-block h-2 w-32 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-500" />
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 p-4">
          <div className="font-medium text-red-300">⚠️ Forecast Error</div>
          <div className="mt-1 text-sm text-red-400">{error}</div>
        </div>
      )}

      {/* Metadata strip */}
      {data && !loading && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <MetricCard
            label="Direction"
            value={<span className={directionColor}>{directionIcon} {data.metadata.direction.toUpperCase()}</span>}
          />
          <MetricCard
            label="Confidence"
            value={<span className={directionColor}>{data.metadata.confidence_pct}%</span>}
          />
          <MetricCard
            label="Predicted Δ"
            value={
              <span className={data.metadata.predicted_change_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                {data.metadata.predicted_change_pct >= 0 ? '+' : ''}{data.metadata.predicted_change_pct}%
              </span>
            }
          />
          <MetricCard label="Current" value={`₹${data.metadata.current_price.toLocaleString('en-IN')}`} />
          <MetricCard
            label={`Target (${data.horizon}${data.interval === '1h' ? 'h' : 'd'})`}
            value={`₹${data.metadata.forecast_final_price.toLocaleString('en-IN')}`}
          />
          <MetricCard label="Time" value={`${(data.metadata.predict_time_ms / 1000).toFixed(1)}s`} />
        </div>
      )}

      {/* Forecast table — candles view only */}
      {data && !loading && viewMode === 'candles' && (
        <div className="max-h-48 overflow-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Open</th>
                <th className="px-3 py-2 text-right">High</th>
                <th className="px-3 py-2 text-right">Low</th>
                <th className="px-3 py-2 text-right">Close</th>
                <th className="px-3 py-2 text-right">P10</th>
                <th className="px-3 py-2 text-right">P90</th>
                <th className="px-3 py-2 text-right">Range</th>
              </tr>
            </thead>
            <tbody>
              {data.forecast.map((c, i) => {
                const date = new Date(c.time * 1000)
                const range = c.p90_close - c.p10_close
                return (
                  <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-3 py-2 text-slate-300">
                      {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{c.open.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-green-400">{c.high.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-red-400">{c.low.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium text-white">{c.close.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{c.p10_close.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{c.p90_close.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">±{range.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function MetricCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/50 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

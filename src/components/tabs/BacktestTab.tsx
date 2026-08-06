'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createChart, ColorType, CrosshairMode, AreaSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import { INSTRUMENTS } from '@/types'

// ─── Types ────────────────────────────────────────────────────────

interface EquityPoint {
  date: string
  equity: number
}

interface BacktestTrade {
  symbol: string
  entryDate: string
  exitDate: string | null
  entryPrice: number
  exitPrice: number | null
  pnl: number | null
  pnlPct: number | null
  exitReason: string | null
  entryReason: string | null
  strategy: string | null
  maxFavorable: number | null
  maxAdverse: number | null
}

interface StrategyStat {
  trades: number
  wins: number
  losses: number
  winRate: number
  avgPnlPct: number
  totalPnl: number
}

interface BacktestResult {
  id: number
  startingCapital: number
  finalEquity: number
  totalReturnPct: number
  totalTrades: number
  winRate: number
  sharpeRatio: number | null
  maxDrawdownPct: number
  profitFactor: number
  avgWinPct: number
  avgLossPct: number
  avgHoldDays: number
  equityCurve: EquityPoint[]
  strategyStats: Record<string, StrategyStat>
  trades: BacktestTrade[]
}

interface PastBacktest {
  id: number
  name: string
  startDate: string
  endDate: string
  totalReturnPct: number
  winRate: number
  totalTrades: number
}

// ─── Defaults ─────────────────────────────────────────────────────

const TRADABLE = INSTRUMENTS.filter((i) => i.currency === 'INR' && i.symbol !== 'NIFTY50')

function defaultStartDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 3) // 3 months back
  return d.toISOString().slice(0, 10)
}

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Component ────────────────────────────────────────────────────

export default function BacktestTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const [startDate, setStartDate] = useState(defaultStartDate())
  const [endDate, setEndDate] = useState(defaultEndDate())
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(TRADABLE.map((i) => i.symbol))
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pastBacktests, setPastBacktests] = useState<PastBacktest[]>([])
  const [selectedPastId, setSelectedPastId] = useState<number | ''>('')
  const autoLoadedRef = useRef(false)

  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const equitySeriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  const loadPastBacktest = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/backtest/${id}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setResult(data)
      setSelectedPastId(id)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [])

  const fetchPastBacktests = useCallback(async (autoLoadLatest: boolean) => {
    try {
      const res = await fetch('/api/backtest')
      if (res.ok) {
        const data: PastBacktest[] = await res.json()
        setPastBacktests(data)
        if (autoLoadLatest && data.length > 0) {
          await loadPastBacktest(data[0].id)
        }
      }
    } catch { /* ignore */ }
  }, [loadPastBacktest])

  // Load past backtests on mount + after cron refresh; auto-show latest result
  useEffect(() => {
    const shouldAuto = !autoLoadedRef.current || refreshKey > 0
    if (!autoLoadedRef.current) autoLoadedRef.current = true
    fetchPastBacktests(shouldAuto)
  }, [refreshKey, fetchPastBacktests])

  // ── Chart init ──
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 380,
      layout: { background: { type: ColorType.Solid, color: '#0a0e17' }, textColor: '#8a9bb4' },
      grid: {
        vertLines: { color: 'rgba(42, 52, 71, 0.3)' },
        horzLines: { color: 'rgba(42, 52, 71, 0.3)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a3447' },
      timeScale: { borderColor: '#2a3447' },
    })
    chartRef.current = chart

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (chartRef.current) chartRef.current.applyOptions({ width: e.contentRect.width })
      }
    })
    ro.observe(chartContainerRef.current)

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
  }, [])

  // ── Render equity curve when result changes ──
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !result) return

    // Remove old series
    if (equitySeriesRef.current) {
      try { chart.removeSeries(equitySeriesRef.current) } catch { /* */ }
    }

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.4)',
      bottomColor: 'rgba(59, 130, 246, 0.02)',
      lineWidth: 2,
    })
    equitySeriesRef.current = series

    const data = result.equityCurve.map((p) => ({
      time: Math.floor(new Date(p.date).getTime() / 1000) as UTCTimestamp,
      value: p.equity,
    }))
    series.setData(data)
    chart.timeScale().fitContent()
  }, [result])

  // ── Run backtest ──
  const runBacktest = useCallback(async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress('Fetching historical data...')

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          symbols: selectedSymbols.length > 0 ? selectedSymbols : undefined,
          name: `Backtest ${startDate} → ${endDate}`,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Backtest failed')
      }

      setResult(data)
      setProgress('')
      fetchPastBacktests(false) // refresh list without reloading result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRunning(false)
      setProgress('')
    }
  }, [startDate, endDate, selectedSymbols, fetchPastBacktests])

  // ── Symbol toggle ──
  const toggleSymbol = (sym: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    )
  }

  const toggleAll = () => {
    if (selectedSymbols.length === TRADABLE.length) {
      setSelectedSymbols([])
    } else {
      setSelectedSymbols(TRADABLE.map((i) => i.symbol))
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-white">📊 Strategy Backtest</h2>
        <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400">
          Historical Performance Validation
        </span>
      </div>

      {/* Configuration */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Date range */}
          <div className="space-y-2">
            <label className="text-xs text-slate-400">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
            <label className="text-xs text-slate-400">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
          </div>

          {/* Stock selector */}
          <div className="md:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-slate-400">
                Stocks ({selectedSymbols.length}/{TRADABLE.length} selected)
              </label>
              <button
                onClick={toggleAll}
                className="text-xs text-blue-400 hover:underline"
              >
                {selectedSymbols.length === TRADABLE.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-2">
              {TRADABLE.map((inst) => (
                <button
                  key={inst.symbol}
                  onClick={() => toggleSymbol(inst.symbol)}
                  className={`rounded px-2 py-1 text-xs ${
                    selectedSymbols.includes(inst.symbol)
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}
                >
                  {inst.symbol}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action row */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={runBacktest}
            disabled={running || selectedSymbols.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? '⏳ Running...' : '🚀 Run Backtest'}
          </button>
          {progress && <span className="text-sm text-slate-400">{progress}</span>}
          {pastBacktests.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500">Load past:</span>
              <select
                value={selectedPastId}
                onChange={(e) => e.target.value && loadPastBacktest(parseInt(e.target.value, 10))}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white"
              >
                <option value="">Select...</option>
                {pastBacktests.map((bt) => (
                  <option key={bt.id} value={bt.id}>
                    #{bt.id} — {bt.totalReturnPct >= 0 ? '+' : ''}{bt.totalReturnPct.toFixed(1)}% ({bt.winRate.toFixed(0)}% WR, {bt.totalTrades} trades)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 p-4">
          <div className="font-medium text-red-300">⚠️ Backtest Error</div>
          <div className="mt-1 text-sm text-red-400">{error}</div>
        </div>
      )}

      {/* Loading overlay */}
      {running && (
        <div className="flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800/50 p-8">
          <div className="text-center">
            <div className="mb-3 text-4xl animate-pulse">📊</div>
            <div className="font-medium text-white">{progress || 'Processing...'}</div>
            <div className="mt-1 text-xs text-slate-400">
              Fetching {selectedSymbols.length} stocks × {(Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)).toLocaleString()} days
            </div>
            <div className="mt-3 inline-block h-2 w-48 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !running && (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label="Total Return"
              value={
                <span className={result.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {result.totalReturnPct >= 0 ? '+' : ''}{result.totalReturnPct.toFixed(1)}%
                </span>
              }
            />
            <MetricCard
              label="Final Equity"
              value={`₹${result.finalEquity.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
            />
            <MetricCard
              label="Win Rate"
              value={
                <span className={result.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>
                  {result.winRate.toFixed(1)}%
                </span>
              }
            />
            <MetricCard
              label="Total Trades"
              value={result.totalTrades.toString()}
            />
            <MetricCard
              label="Max Drawdown"
              value={<span className="text-red-400">-{result.maxDrawdownPct.toFixed(1)}%</span>}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={
                result.sharpeRatio != null
                  ? result.sharpeRatio.toFixed(2)
                  : 'N/A'
              }
            />
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Profit Factor" value={result.profitFactor.toFixed(2)} />
            <MetricCard
              label="Avg Win"
              value={<span className="text-green-400">+{result.avgWinPct.toFixed(1)}%</span>}
            />
            <MetricCard
              label="Avg Loss"
              value={<span className="text-red-400">{result.avgLossPct.toFixed(1)}%</span>}
            />
            <MetricCard label="Avg Hold" value={`${result.avgHoldDays.toFixed(1)}d`} />
          </div>

          {/* Equity Curve */}
          <div className="shrink-0">
            <h3 className="mb-2 text-sm font-medium text-slate-300">📈 Equity Curve</h3>
            <div ref={chartContainerRef} className="h-[380px] w-full rounded-lg border border-slate-800" />
          </div>

          {/* Strategy breakdown */}
          {Object.keys(result.strategyStats).length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-300">🎯 Per-Strategy Breakdown</h3>
              <div className="overflow-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800 text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Strategy</th>
                      <th className="px-3 py-2 text-right">Trades</th>
                      <th className="px-3 py-2 text-right">Win Rate</th>
                      <th className="px-3 py-2 text-right">Avg P&L %</th>
                      <th className="px-3 py-2 text-right">Total P&L ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.strategyStats).map(([name, stat]) => (
                      <tr key={name} className="border-t border-slate-800 hover:bg-slate-800/50">
                        <td className="px-3 py-2 font-medium text-white">{name}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{stat.trades}</td>
                        <td className={`px-3 py-2 text-right ${stat.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                          {stat.winRate.toFixed(0)}%
                        </td>
                        <td className={`px-3 py-2 text-right ${stat.avgPnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {stat.avgPnlPct >= 0 ? '+' : ''}{stat.avgPnlPct.toFixed(2)}%
                        </td>
                        <td className={`px-3 py-2 text-right font-medium ${stat.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {stat.totalPnl >= 0 ? '+' : ''}₹{stat.totalPnl.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trade list */}
          {result.trades.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-300">
                📋 Trade List ({result.trades.length} trades)
              </h3>
              <div className="max-h-80 overflow-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800 text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Entry</th>
                      <th className="px-3 py-2 text-left">Exit</th>
                      <th className="px-3 py-2 text-right">Entry</th>
                      <th className="px-3 py-2 text-right">Exit</th>
                      <th className="px-3 py-2 text-right">P&L %</th>
                      <th className="px-3 py-2 text-right">P&L ₹</th>
                      <th className="px-3 py-2 text-left">Exit Reason</th>
                      <th className="px-3 py-2 text-left">Strategy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/50">
                        <td className="px-3 py-2 font-medium text-white">{t.symbol}</td>
                        <td className="px-3 py-2 text-slate-300">{t.entryDate.slice(0, 10)}</td>
                        <td className="px-3 py-2 text-slate-300">{t.exitDate?.slice(0, 10) || '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{t.entryPrice.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{t.exitPrice?.toFixed(2) || '—'}</td>
                        <td className={`px-3 py-2 text-right font-medium ${(t.pnlPct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(t.pnlPct ?? 0) >= 0 ? '+' : ''}{(t.pnlPct ?? 0).toFixed(1)}%
                        </td>
                        <td className={`px-3 py-2 text-right ${(t.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(t.pnl ?? 0) >= 0 ? '+' : ''}₹{(t.pnl ?? 0).toFixed(0)}
                        </td>
                        <td className="px-3 py-2 text-slate-400">{t.exitReason || '—'}</td>
                        <td className="px-3 py-2 text-slate-400">{t.strategy || t.entryReason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !running && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-700 bg-slate-800/30 p-12">
          <div className="mb-3 text-5xl">📊</div>
          <div className="text-lg font-medium text-slate-300">No backtest yet</div>
          <div className="mt-1 text-sm text-slate-500">
            Select a date range and stocks, then click Run Backtest to see how the strategies perform historically.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helper ───────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/50 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

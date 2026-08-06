'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCurrency } from '@/lib/currency'

interface HealthData {
  totalEquity: number
  startingEquity: number
  drawdownPct: number
  cashAvailable: number
  cashPct: number
  positionsCount: number
  dailyPnl: number
  circuitBreakerActive: boolean
  maxPositionsAllowed: number
}

interface PositionData {
  symbol: string
  side: string
  entryPrice: number
  quantity: number
  peakPrice: number
  createdAt: string
}

interface MetricsData {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  totalReturn: number
  expectancy: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  cagr: number
  sharpe: number
  maxDrawdown: number
  xirr: number
}

export default function HealthTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const { fmt } = useCurrency()
  const [risk, setRisk] = useState<HealthData | null>(null)
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [positions, setPositions] = useState<PositionData[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [riskRes, metricsRes, posRes] = await Promise.all([
        fetch('/api/risk'),
        fetch('/api/metrics'),
        fetch('/api/positions'),
      ])
      if (riskRes.ok) {
        const riskJson = await riskRes.json()
        setRisk(riskJson.data || riskJson)
      }
      if (metricsRes.ok) {
        const metricsJson = await metricsRes.json()
        setMetrics(metricsJson.data || metricsJson)
      }
      if (posRes.ok) {
        const posData = await posRes.json()
        setPositions(posData.positions || posData.data || posData)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData, refreshKey])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[var(--text-secondary)]">Loading portfolio health...</div>
      </div>
    )
  }

  // Risk score calculation (0-100, higher = safer)
  const riskScore = risk ? (() => {
    let score = 100
    score -= Math.min(30, risk.drawdownPct * 3.75) // drawdown penalty
    score -= risk.circuitBreakerActive ? 20 : 0
    score -= risk.cashPct < 10 ? 15 : risk.cashPct < 20 ? 5 : 0 // cash buffer
    score -= (risk.positionsCount / risk.maxPositionsAllowed) > 0.8 ? 10 : 0
    return Math.max(0, Math.round(score))
  })() : 0

  const riskColor = riskScore >= 70 ? 'text-green-400' : riskScore >= 40 ? 'text-yellow-400' : 'text-red-400'
  const riskLabel = riskScore >= 70 ? 'SAFE' : riskScore >= 40 ? 'CAUTION' : 'HIGH RISK'

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">📊 Portfolio Health</h2>
          <p className="text-xs text-[var(--text-secondary)]">Real-time risk monitoring and performance analytics</p>
        </div>

        {/* Risk Score Banner */}
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-[var(--text-secondary)]">Portfolio Risk Score</div>
              <div className={`text-4xl font-bold ${riskColor}`}>{riskScore}</div>
              <div className={`text-sm font-medium ${riskColor}`}>{riskLabel}</div>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex justify-between gap-8">
                <span className="text-[var(--text-secondary)]">Drawdown</span>
                <span className={risk && risk.drawdownPct > 5 ? 'text-red-400' : 'text-green-400'}>
                  {risk?.drawdownPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-[var(--text-secondary)]">Cash Buffer</span>
                <span className={risk && risk.cashPct < 20 ? 'text-yellow-400' : 'text-green-400'}>
                  {risk?.cashPct.toFixed(1)}% ({fmt(risk?.cashAvailable ?? 0, { decimals: 0 })})
                </span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-[var(--text-secondary)]">Positions</span>
                <span className="text-[var(--text-primary)]">
                  {risk?.positionsCount}/{risk?.maxPositionsAllowed}
                </span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-[var(--text-secondary)]">Daily P&L</span>
                <span className={risk && risk.dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {risk && risk.dailyPnl >= 0 ? '+' : ''}{fmt(risk?.dailyPnl ?? 0, { decimals: 2 })}
                </span>
              </div>
              {risk?.circuitBreakerActive && (
                <div className="mt-1 rounded bg-red-500/20 px-2 py-0.5 text-center text-[10px] font-medium text-red-400">
                  ⚠️ CIRCUIT BREAKER ACTIVE
                </div>
              )}
            </div>
          </div>

          {/* Risk score visual */}
          <div className="mt-3">
            <div className="relative h-3 rounded-full bg-[var(--bg-hover)]">
              <div className="absolute left-0 h-full w-1/3 rounded-l-full bg-green-500/30" />
              <div className="absolute left-1/3 h-full w-1/3 bg-yellow-500/30" />
              <div className="absolute right-0 h-full w-1/3 rounded-r-full bg-red-500/30" />
              <div
                className="absolute top-0 h-full w-1 rounded-full bg-[var(--text-primary)]"
                style={{ left: `${100 - riskScore}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-[var(--text-secondary)]">
              <span>High Risk (0)</span>
              <span>Caution (40)</span>
              <span>Safe (70+)</span>
            </div>
          </div>
        </div>

        {/* Performance Metrics Grid */}
        {metrics && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">📈 Performance Metrics</h3>
            <div className="grid grid-cols-4 gap-3">
              <MetricCard label="Total P&L" value={`${metrics.totalPnl >= 0 ? '+' : ''}${fmt(metrics.totalPnl, { decimals: 2 })}`} positive={metrics.totalPnl >= 0} />
              <MetricCard label="Total Return" value={`${metrics.totalReturn.toFixed(2)}%`} positive={metrics.totalReturn >= 0} />
              <MetricCard label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} />
              <MetricCard label="Trades" value={String(metrics.totalTrades)} />
              <MetricCard label="Sharpe" value={metrics.sharpe.toFixed(2)} positive={metrics.sharpe >= 1} />
              <MetricCard label="Max DD" value={`${metrics.maxDrawdown.toFixed(1)}%`} positive={metrics.maxDrawdown < 8} />
              <MetricCard label="Profit Factor" value={metrics.profitFactor.toFixed(2)} positive={metrics.profitFactor >= 1} />
              <MetricCard label="Expectancy" value={fmt(metrics.expectancy, { decimals: 2 })} positive={metrics.expectancy >= 0} />
              <MetricCard label="Avg Win" value={`+${fmt(metrics.avgWin, { decimals: 2 })}`} positive />
              <MetricCard label="Avg Loss" value={`-${fmt(Math.abs(metrics.avgLoss), { decimals: 2 })}`} positive={false} />
              <MetricCard label="CAGR" value={`${metrics.cagr.toFixed(1)}%`} positive={metrics.cagr >= 0} />
              <MetricCard label="XIRR" value={`${metrics.xirr.toFixed(1)}%`} positive={metrics.xirr >= 0} />
            </div>
          </div>
        )}

        {/* Open Positions */}
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">📊 Open Positions ({positions.length})</h3>
          {positions.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--text-secondary)]">No open positions</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                    <th className="px-2 py-1 text-left">Symbol</th>
                    <th className="px-2 py-1 text-right">Entry</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Peak</th>
                    <th className="px-2 py-1 text-right">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.symbol} className="border-b border-[var(--border-color)]/50">
                      <td className="px-2 py-1.5 font-medium text-[var(--text-primary)]">{p.symbol}</td>
                      <td className="px-2 py-1.5 text-right">₹{p.entryPrice.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right">{p.quantity.toFixed(4)}</td>
                      <td className="px-2 py-1.5 text-right text-green-400">₹{p.peakPrice.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">
                        {new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg bg-[var(--bg-tertiary)] p-3 text-center">
      <div className={`text-base font-bold ${positive === undefined ? 'text-[var(--text-primary)]' : positive ? 'text-green-400' : 'text-red-400'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}

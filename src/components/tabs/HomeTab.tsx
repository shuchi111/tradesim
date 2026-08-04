'use client'

import { useEffect, useState } from 'react'
import TradingPanel from '@/components/TradingPanel'
import { useCurrency } from '@/lib/currency'

interface HomeTabProps {
  symbol: string
  refreshKey: number
  onTradeComplete: () => void
}

interface Metrics {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  realizedPnl?: number
  totalReturn: number
  investedCapital?: number
  totalDeposited?: number
  expectancy: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  cagr: number | null
  sharpe: number | null
  maxDrawdown: number | null
  xirr: number | null
  currentEquity: number
  startingEquity: number
  balance: number
  positionsValue: number
  unrealizedPnl?: number
}

export default function HomeTab({ symbol, refreshKey, onTradeComplete }: HomeTabProps) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const { fmt, convert } = useCurrency()

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/metrics')
        const json = await res.json()
        if (json.data) setMetrics(json.data)
      } catch {
        // ignore
      }
    }
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 10000)
    return () => clearInterval(interval)
  }, [refreshKey])

  const fmtPct = (n: number | null | undefined) => `${n != null && n >= 0 ? '+' : ''}${(n ?? 0).toFixed(2)}%`

  // Prefer API totalPnl (excludes SIP). Fallback formula if older response.
  const invested =
    metrics?.investedCapital ??
    (metrics ? metrics.startingEquity + (metrics.totalDeposited ?? 0) : 0)
  const pnl = metrics?.totalPnl ?? 0
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Metrics dashboard */}
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="mb-3 text-lg font-bold">📊 Performance Metrics</h2>

        {/* Top row: P&L summary */}
        <div className="mb-4 grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
            <div className="text-xs text-[var(--text-secondary)]">Total P&L</div>
            <div className={`text-xl font-bold tabular-nums ${pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {metrics ? fmt(pnl) : '—'}
            </div>
            <div className={`text-xs tabular-nums ${pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {fmtPct(pnlPct)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
            <div className="text-xs text-[var(--text-secondary)]">Current Equity</div>
            <div className="text-xl font-bold tabular-nums">
              {metrics ? fmt(metrics.currentEquity) : '—'}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Invested: {metrics ? fmt(invested) : ''}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
            <div className="text-xs text-[var(--text-secondary)]">Realized P&L</div>
            <div className={`text-xl font-bold tabular-nums ${(metrics?.realizedPnl ?? metrics?.totalPnl ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {metrics ? fmt(metrics.realizedPnl ?? 0) : '—'}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Unrealized: {metrics ? fmt(metrics.unrealizedPnl ?? 0) : ''}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
            <div className="text-xs text-[var(--text-secondary)]">Positions Value</div>
            <div className="text-xl font-bold tabular-nums">
              {metrics ? fmt(metrics.positionsValue) : '—'}
            </div>
          </div>
        </div>

        {/* Advanced metrics grid */}
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          Advanced Metrics
        </h3>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Expectancy" value={metrics ? fmt(metrics.expectancy) : '—'} hint="Per trade" good={metrics ? metrics.expectancy > 0 : false} />
          <MetricCard label="XIRR" value={metrics ? fmtPct(metrics.xirr) : '—'} hint="Annualized" good={metrics ? (metrics.xirr ?? 0) > 0 : false} />
          <MetricCard label="CAGR" value={metrics ? fmtPct(metrics.cagr) : '—'} hint="Annualized growth" good={metrics ? (metrics.cagr ?? 0) > 0 : false} />
          <MetricCard label="Sharpe Ratio" value={metrics ? (metrics.sharpe ?? 0).toFixed(2) : '—'} hint="Risk-adjusted" good={metrics ? (metrics.sharpe ?? 0) > 1 : false} />
          <MetricCard label="Max Drawdown" value={metrics ? `-${(metrics.maxDrawdown ?? 0).toFixed(1)}%` : '—'} hint="Peak to trough" bad />
          <MetricCard label="Win Rate" value={metrics ? `${(metrics.winRate ?? 0).toFixed(1)}%` : '—'} hint={`${metrics?.wins ?? 0}W / ${metrics?.losses ?? 0}L`} good={metrics ? (metrics.winRate ?? 0) >= 50 : false} />
          <MetricCard label="Profit Factor" value={metrics ? (metrics.profitFactor ?? 0).toFixed(2) : '—'} hint="Gross P / Gross L" good={metrics ? (metrics.profitFactor ?? 0) > 1.5 : false} />
          <MetricCard label="Total Trades" value={metrics ? String(metrics.totalTrades) : '—'} hint="Closed trades" />
          <MetricCard label="Avg Win" value={metrics ? fmt(metrics.avgWin) : '—'} hint="Per winning trade" good />
          <MetricCard label="Avg Loss" value={metrics ? fmt(metrics.avgLoss) : '—'} hint="Per losing trade" bad />
        </div>

        {/* Quick start info */}
        <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
          <p className="mb-1"><b className="text-[var(--text-primary)]">Strategy:</b> Swing Trading — SMA(5/20) crossover + RSI(14) confirmation</p>
          <p className="mb-1"><b className="text-[var(--text-primary)]">Instruments:</b> All 50 Nifty 50 stocks + Apple, NVIDIA, Tesla (US)</p>
          <p><b className="text-[var(--text-primary)]">Capital:</b> {fmt(100000, { decimals: 0 })} virtual</p>
        </div>
      </div>

      {/* Right: Quick trade panel */}
      <div className="w-[320px] border-l border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-y-auto">
        <TradingPanel symbol={symbol} onTradeComplete={onTradeComplete} />
      </div>
    </div>
  )
}

function MetricCard({ label, value, hint, good, bad }: { label: string; value: string; hint?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${
        good ? 'text-[var(--green)]' : bad ? 'text-[var(--red)]' : ''
      }`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-[var(--text-secondary)]">{hint}</div>}
    </div>
  )
}

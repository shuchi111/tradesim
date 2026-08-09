'use client'

import { useEffect, useState, useCallback } from 'react'
import { INSTRUMENTS, getInstrument, type StrategySignal } from '@/types'
import { useCurrency } from '@/lib/currency'

interface StrategyPanelProps {
  onTradeComplete: () => void
  refreshKey?: number
}

interface RiskStatus {
  totalEquity: number
  startingEquity: number
  totalDeposited?: number
  investedCapital?: number
  totalPnl?: number
  drawdownPct: number
  cashAvailable: number
  cashPct: number
  positionsCount: number
  positionsRisked: number
  dailyPnl: number
  circuitBreakerActive: boolean
  maxPositionsAllowed: number | null
  maxRiskPerTradePct: number
}

interface AutoTradeResult {
  instrument: string
  signal: string
  action: string
  detail: string
  pnl?: number
  pnlPct?: number
}

export default function StrategyPanel({ onTradeComplete, refreshKey = 0 }: StrategyPanelProps) {
  const { fmt, convert, symbol } = useCurrency()
  const [signals, setSignals] = useState<StrategySignal[]>([])
  const [autoTrading, setAutoTrading] = useState(false)
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [results, setResults] = useState<AutoTradeResult[]>([])
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [marketOpen, setMarketOpen] = useState(true)
  const [istTime, setIstTime] = useState<string>('')
  const [risk, setRisk] = useState<RiskStatus | null>(null)

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy')
      const json = await res.json()
      if (json.data) setSignals(json.data)
    } catch {
      // ignore
    }
  }, [])

  const fetchRisk = useCallback(async () => {
    try {
      const res = await fetch('/api/risk')
      const json = await res.json()
      if (json.data) setRisk(json.data)
    } catch {
      // ignore
    }
  }, [])

  // Fetch auto-trade status from the server
  const fetchAutoStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy/autotrade/status')
      const json = await res.json()
      if (json.data) {
        setAutoEnabled(json.data.enabled)
        setMarketOpen(json.data.marketOpen)
        setIstTime(json.data.istTime)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchSignals()
    fetchRisk()
    fetchAutoStatus()
    const sigInterval = setInterval(fetchSignals, 60000)
    const riskInterval = setInterval(fetchRisk, 10000)
    const statusInterval = setInterval(fetchAutoStatus, 30000)
    return () => {
      clearInterval(sigInterval)
      clearInterval(riskInterval)
      clearInterval(statusInterval)
    }
  }, [fetchSignals, fetchRisk, fetchAutoStatus, refreshKey])

  // Toggle auto-trade via server API (persists in DB, server-side loop reads it)
  const toggleAuto = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy/autotrade/status', { method: 'PATCH' })
      const json = await res.json()
      if (json.data) {
        setAutoEnabled(json.data.enabled)
      }
    } catch {
      // ignore
    }
  }, [])

  const handleManualRun = async () => {
    setAutoTrading(true)
    try {
      const res = await fetch('/api/strategy/autotrade', { method: 'POST' })
      const json = await res.json()
      if (json.data) {
        setResults(json.data)
        setLastRun(new Date().toLocaleTimeString())
        onTradeComplete()
        fetchRisk()
      }
    } catch {
      // ignore
    } finally {
      setAutoTrading(false)
    }
  }

  const signalColor = (s: string) => {
    if (s === 'BUY') return 'text-[var(--green)] bg-green-900/30'
    if (s === 'SELL') return 'text-[var(--red)] bg-red-900/30'
    return 'text-[var(--text-secondary)] bg-[var(--bg-tertiary)]'
  }

  // Sort signals: BUY first (by confidence desc), then SELL, then HOLD
  const sortedSignals = [...signals].sort((a, b) => {
    const order = { BUY: 0, SELL: 1, HOLD: 2 }
    const diff = order[a.signal as keyof typeof order] - order[b.signal as keyof typeof order]
    if (diff !== 0) return diff
    return b.confidence - a.confidence
  })

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          🎯 Auto-Trade Engine
          <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-medium text-[var(--yellow)]">
            5-Strategy Consensus
          </span>
          {risk?.circuitBreakerActive && (
            <span className="animate-pulse rounded bg-red-900/40 px-2 py-0.5 text-[10px] font-bold text-[var(--red)]">
              ⚠️ CIRCUIT BREAKER
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAuto}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              autoEnabled
                ? 'bg-[var(--green)] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}
          >
            {autoEnabled ? '⏸ Auto ON' : '▶ Auto OFF'}
          </button>
          <button
            onClick={handleManualRun}
            disabled={autoTrading}
            className="rounded-md bg-[var(--blue)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {autoTrading ? 'Running...' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* Risk Management Dashboard */}
      {risk && (() => {
        return (
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-[var(--bg-primary)] p-3">
          <div className="text-center">
            <div className="text-[10px] uppercase text-[var(--text-secondary)]">Equity</div>
            <div className="text-sm font-bold tabular-nums">
              {fmt(risk.totalEquity, { decimals: 0 })}
            </div>
            <div className={`text-[10px] ${(risk.totalPnl ?? (risk.totalEquity - (risk.investedCapital ?? risk.startingEquity))) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {(() => {
                const invested = risk.investedCapital ?? (risk.startingEquity + (risk.totalDeposited ?? 0))
                const pnl = risk.totalPnl ?? (risk.totalEquity - invested)
                const pct = invested > 0 ? (pnl / invested) * 100 : 0
                return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
              })()}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase text-[var(--text-secondary)]">Cash Reserve</div>
            <div className={`text-sm font-bold tabular-nums ${risk.cashPct >= 20 ? 'text-[var(--green)]' : 'text-[var(--yellow)]'}`}>
              {risk.cashPct.toFixed(1)}%
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">
              {fmt(risk.cashAvailable, { decimals: 0 })}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase text-[var(--text-secondary)]">Positions</div>
            <div className="text-sm font-bold tabular-nums">
              {risk.positionsCount}
              {risk.maxPositionsAllowed != null ? `/${risk.maxPositionsAllowed}` : ''}
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">
              {fmt(risk.positionsRisked, { decimals: 0 })}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase text-[var(--text-secondary)]">Daily P&L</div>
            <div className={`text-sm font-bold tabular-nums ${risk.dailyPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {risk.dailyPnl >= 0 ? '+' : '-'}{fmt(Math.abs(risk.dailyPnl), { decimals: 0 })}
            </div>
            <div className={`text-[10px] ${risk.drawdownPct > 5 ? 'text-[var(--red)]' : 'text-[var(--text-secondary)]'}`}>
              DD: {risk.drawdownPct.toFixed(1)}%
            </div>
          </div>
        </div>
        )
      })()}

      {/* Risk Protection Rules */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded bg-red-900/20 px-2 py-0.5 text-[var(--red)]">🛑 Stop-Loss -7%</span>
        <span className="rounded bg-green-900/20 px-2 py-0.5 text-[var(--green)]">🎯 Take-Profit +15%</span>
        <span className="rounded bg-blue-900/20 px-2 py-0.5 text-[var(--blue)]">🔒 Trailing Stop +7%</span>
        <span className="rounded bg-yellow-900/20 px-2 py-0.5 text-[var(--yellow)]">⚠️ Circuit Breaker -6%</span>
        <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[var(--text-secondary)]">📊 Unlimited Positions</span>
        <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[var(--text-secondary)]">💰 30% Cash Reserve</span>
        <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[var(--text-secondary)]">🎯 Size by Confidence (no min gate)</span>
        <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[var(--text-secondary)]">✂️ Partial Profit +5%</span>
        <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[var(--text-secondary)]">⏱️ Time Exit 10d</span>
        <span className="rounded bg-green-900/20 px-2 py-0.5 text-[var(--green)]">✅ All NIFTY 50 Stocks</span>
      </div>

      {/* Signal cards — sorted by signal priority */}
      <div className="grid grid-cols-3 gap-2">
        {sortedSignals.slice(0, 18).map((sig) => {
          const inst = getInstrument(sig.instrument)
          return (
            <div key={sig.instrument} className={`rounded-md border p-2 ${
              sig.signal === 'BUY' ? 'border-[var(--green)]/30 bg-green-900/5' :
              sig.signal === 'SELL' ? 'border-[var(--red)]/30 bg-red-900/5' :
              'border-[var(--border-color)] bg-[var(--bg-tertiary)]'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{inst?.base ?? sig.instrument}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${signalColor(sig.signal)}`}>
                  {sig.signal}
                </span>
              </div>
              {sig.signal !== 'HOLD' && (
                <div className="mt-1 space-y-0.5 text-[10px] text-[var(--text-secondary)]">
                  <div className="flex justify-between">
                    <span>Price</span>
                    <span className="tabular-nums">
                      {convert(sig.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>RSI</span>
                    <span className={`tabular-nums ${sig.indicators.rsi14 > 70 ? 'text-[var(--red)]' : sig.indicators.rsi14 < 30 ? 'text-[var(--green)]' : ''}`}>
                      {sig.indicators.rsi14}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Confidence</span>
                    <span className={`tabular-nums font-bold ${sig.confidence >= 70 ? 'text-[var(--green)]' : sig.confidence >= 50 ? 'text-[var(--yellow)]' : ''}`}>
                      {sig.confidence}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Server-side auto-trade status */}
      <div className="rounded-md bg-[var(--bg-primary)] p-2 text-xs">
        <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
          <span>
            {autoEnabled ? (
              <>
                ✅ Auto-trade ON — server loop active (every 2 min)
                {!marketOpen && <span className="ml-2 text-[var(--yellow)]">⏰ Market closed ({istTime})</span>}
              </>
            ) : (
              'Auto-trade OFF — toggle to enable server-side trading'
            )}
          </span>
          {autoEnabled && marketOpen && (
            <span className="text-[var(--green)]">🤖 Trading active · {istTime}</span>
          )}
        </div>
      </div>

      {/* Last run results */}
      {(results.length > 0 || lastRun) && (
        <div className="rounded-md bg-[var(--bg-primary)] p-2 text-xs">
          {lastRun && (
            <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span>Last manual run: {lastRun}</span>
            </div>
          )}
          <div className="max-h-40 overflow-y-auto">
            {results.filter((r) => r.action !== 'WAIT' && r.action !== 'SKIP').map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                  r.action === 'BOUGHT' ? 'bg-green-900/30 text-[var(--green)]' :
                  r.action === 'SOLD' ? 'bg-red-900/30 text-[var(--red)]' :
                  r.action === 'CIRCUIT_BREAKER' ? 'bg-red-900/40 text-[var(--red)]' :
                  r.action === 'MAX_POSITIONS' || r.action === 'LOW_CASH' ? 'bg-yellow-900/30 text-[var(--yellow)]' :
                  'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                }`}>
                  {r.action}
                </span>
                <span className="font-medium">{getInstrument(r.instrument)?.base ?? r.instrument}</span>
                {r.pnl !== undefined && (
                  <span className={`tabular-nums ${r.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                    {r.pnl >= 0 ? '+' : '-'}{fmt(Math.abs(r.pnl), { decimals: 0 })}
                  </span>
                )}
                <span className="truncate text-[var(--text-secondary)]">{r.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

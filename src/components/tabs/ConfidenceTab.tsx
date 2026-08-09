'use client'

import { useState, useEffect, useCallback } from 'react'
import { INSTRUMENTS } from '@/types'

interface ConfidenceResult {
  symbol: string
  price: number
  overallConfidence: number
  components: {
    strategyAgreement: { score: number; weight: number; detail: string }
    mlPrediction: { score: number; weight: number; detail: string }
    kronosAI: { score: number; weight: number; detail: string }
    marketRegime: { score: number; weight: number; detail: string }
    historicalWinRate: { score: number; weight: number; detail: string }
  }
  recommendation: 'STRONG BUY' | 'BUY' | 'HOLD' | 'AVOID'
  factors: { name: string; contribution: number; direction: string }[]
  signal: 'BUY' | 'SELL' | 'HOLD'
}

interface RankedItem {
  symbol: string
  confidence: number
  recommendation: string
  price: number
  components?: ConfidenceResult['components']
  factors?: ConfidenceResult['factors']
}

const COMPONENT_LABELS: Record<string, string> = {
  strategyAgreement: 'Strategy Agreement',
  mlPrediction: 'ML Prediction',
  kronosAI: 'Kronos AI',
  marketRegime: 'Market Regime',
  historicalWinRate: 'Historical Win Rate',
}

export default function ConfidenceTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rankings, setRankings] = useState<RankedItem[]>([])
  const [selected, setSelected] = useState<ConfidenceResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)

  const tradable = INSTRUMENTS.filter(i => i.currency === 'INR' && i.symbol !== 'NIFTY50').slice(0, 20)

  const scanAll = useCallback(async () => {
    setScanning(true)
    setScanProgress(0)
    const results: RankedItem[] = []
    const batchSize = 5

    for (let i = 0; i < tradable.length; i += batchSize) {
      const batch = tradable.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (inst) => {
          try {
            const res = await fetch(`/api/confidence/${inst.symbol}`)
            if (!res.ok) return null
            const data: ConfidenceResult = await res.json()
            return {
              symbol: inst.symbol,
              confidence: data.overallConfidence,
              recommendation: data.recommendation,
              price: data.price,
              components: data.components,
              factors: data.factors,
            } as RankedItem
          } catch {
            return null
          }
        })
      )
      for (const r of batchResults) {
        if (r) results.push(r)
      }
      setScanProgress(Math.min(100, ((i + batchSize) / tradable.length) * 100))
      setRankings([...results].sort((a, b) => b.confidence - a.confidence))
    }
    setScanning(false)
  }, [tradable.length])

  useEffect(() => {
    scanAll()
  }, [scanAll, refreshKey])

  const handleViewDetail = async (symbol: string) => {
    try {
      const res = await fetch(`/api/confidence/${symbol}`)
      if (res.ok) setSelected(await res.json())
    } catch {}
  }

  const recColors: Record<string, string> = {
    'STRONG BUY': 'bg-green-500/20 text-green-400 border-green-500/30',
    'BUY': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'HOLD': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'AVOID': 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  const recTextColor = (rec: string, score: number) => {
    if (rec === 'STRONG BUY' || score >= 80) return 'text-green-400'
    if (rec === 'BUY' || score >= 65) return 'text-blue-400'
    if (rec === 'AVOID' || score < 45) return 'text-red-400'
    return 'text-yellow-400'
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">AI Score</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Composite: Strategy 35% · ML 25% · Kronos 15% · Regime 15% · 10yr Win Rate 10%
            </p>
          </div>
          <button
            onClick={scanAll}
            disabled={scanning}
            className="rounded-lg bg-[var(--blue)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--blue)]/80 disabled:opacity-50"
          >
            {scanning ? `Scanning... ${scanProgress.toFixed(0)}%` : 'Rescan'}
          </button>
        </div>

        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            <div className="rounded bg-[var(--bg-tertiary)] p-2">
              <div className="text-base font-bold text-[var(--blue)]">35%</div>
              <div className="text-[var(--text-secondary)]">Strategy</div>
            </div>
            <div className="rounded bg-[var(--bg-tertiary)] p-2">
              <div className="text-base font-bold text-[var(--blue)]">25%</div>
              <div className="text-[var(--text-secondary)]">ML Prediction</div>
            </div>
            <div className="rounded bg-[var(--bg-tertiary)] p-2">
              <div className="text-base font-bold text-[var(--blue)]">15%</div>
              <div className="text-[var(--text-secondary)]">Kronos AI</div>
            </div>
            <div className="rounded bg-[var(--bg-tertiary)] p-2">
              <div className="text-base font-bold text-[var(--blue)]">15%</div>
              <div className="text-[var(--text-secondary)]">Market Regime</div>
            </div>
            <div className="rounded bg-[var(--bg-tertiary)] p-2">
              <div className="text-base font-bold text-[var(--blue)]">10%</div>
              <div className="text-[var(--text-secondary)]">Win Rate</div>
            </div>
          </div>
        </div>

        {rankings.length === 0 && scanning ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 text-center">
            <p className="text-sm text-[var(--text-secondary)]">Scanning market... {scanProgress.toFixed(0)}%</p>
          </div>
        ) : rankings.length === 0 ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 text-center">
            <p className="text-sm text-[var(--text-secondary)]">No data yet. Click Rescan.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Opportunity Rankings</h3>
            <div className="space-y-1">
              {rankings.map((item, idx) => (
                <div
                  key={item.symbol}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg bg-[var(--bg-tertiary)] p-3 hover:bg-[var(--bg-hover)] ${selected?.symbol === item.symbol ? 'ring-1 ring-[var(--blue)]' : ''}`}
                  onClick={() => handleViewDetail(item.symbol)}
                >
                  <span className={`w-6 text-center text-xs font-bold ${idx < 3 ? 'text-[var(--blue)]' : 'text-[var(--text-secondary)]'}`}>
                    #{idx + 1}
                  </span>
                  <span className="w-24 font-medium text-[var(--text-primary)]">{item.symbol}</span>
                  <span className="text-xs text-[var(--text-secondary)]">₹{item.price.toFixed(2)}</span>
                  <div className="flex-1">
                    <div className="relative h-5 rounded-full bg-[var(--bg-hover)]">
                      <div
                        className={`absolute h-full rounded-full ${item.confidence >= 80 ? 'bg-green-500/60' : item.confidence >= 65 ? 'bg-blue-500/60' : item.confidence >= 45 ? 'bg-yellow-500/60' : 'bg-red-500/60'}`}
                        style={{ width: `${item.confidence}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[var(--text-primary)]">
                        {item.confidence}%
                      </span>
                    </div>
                  </div>
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${recColors[item.recommendation] || recColors['HOLD']}`}>
                    {item.recommendation}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {selected.symbol} — AI Score
              </h3>
              <button
                onClick={() => setSelected(null)}
                className="rounded bg-[var(--bg-hover)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>

            {/* Gauge + recommendation — matches reference layout */}
            <div className="mb-5 flex items-center gap-6">
              <ConfidenceGauge score={selected.overallConfidence} />
              <div>
                <div className={`text-3xl font-bold tracking-wide ${recTextColor(selected.recommendation, selected.overallConfidence)}`}>
                  {selected.recommendation}
                </div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">
                  @ ₹{selected.price.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {Object.entries(selected.components).map(([key, val]) => (
                <div key={key} className="flex items-center gap-3 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2.5">
                  <span className="w-36 shrink-0 text-xs font-medium text-[var(--text-primary)]">
                    {COMPONENT_LABELS[key] || key}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
                      <div
                        className="absolute h-full rounded-full bg-[var(--blue)]"
                        style={{ width: `${Math.max(0, Math.min(100, val.score))}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-8 text-right text-xs font-semibold text-[var(--text-primary)]">
                    {Math.round(val.score)}
                  </span>
                  <span className="w-9 text-right text-[10px] text-[var(--text-secondary)]">
                    {(val.weight * 100).toFixed(0)}%w
                  </span>
                  <span className="hidden w-56 truncate text-right text-[10px] text-[var(--text-secondary)] sm:block" title={val.detail}>
                    {val.detail}
                  </span>
                </div>
              ))}
            </div>

            {selected.factors && selected.factors.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Factor Analysis</h4>
                <div className="space-y-1">
                  {selected.factors.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 rounded bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
                      <span className={`w-16 rounded px-1 text-center text-[10px] font-medium ${
                        f.direction === 'bullish' ? 'bg-green-500/20 text-green-400'
                          : f.direction === 'bearish' ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {f.direction}
                      </span>
                      <span className="flex-1 text-[var(--text-primary)]">{f.name}</span>
                      <span className="text-green-400">+{Math.abs(f.contribution).toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ConfidenceGauge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'text-green-400'
      : score >= 65 ? 'text-blue-400'
        : score >= 45 ? 'text-yellow-400'
          : 'text-red-400'
  const circumference = 2 * Math.PI * 40
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-24 w-24">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-[var(--bg-hover)]" />
          <circle
            cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8"
            className={color}
            strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className={`absolute inset-0 flex items-center justify-center text-2xl font-bold ${color}`}>
          {score}
        </div>
      </div>
    </div>
  )
}

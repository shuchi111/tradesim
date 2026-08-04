'use client'

import { useState } from 'react'

export interface PickData {
  symbol: string
  score: number
  confidence: string
  entry_low: number
  entry_high: number
  stop_loss: number
  target_1: number
  target_2: number
  hold_days_min: number
  hold_days_max: number
  methods_triggered: string[]
  tags: string[]
  risk_tag: string
  key_risk: string
  summary?: {
    close: number
    rsi: number
    vol_ratio: number
    sector?: string
  }
}

const TAG_COLORS: Record<string, string> = {
  BREAKOUT: 'bg-green-500/20 text-green-400',
  EARNINGS_BEAT: 'bg-blue-500/20 text-blue-400',
  FII_BUYING: 'bg-purple-500/20 text-purple-400',
  SECTOR_MOMENTUM: 'bg-cyan-500/20 text-cyan-400',
  OVERSOLD_BOUNCE: 'bg-orange-500/20 text-orange-400',
  ENGULFING: 'bg-pink-500/20 text-pink-400',
  OVEREXTENDED: 'bg-red-500/20 text-red-400',
}

const RISK_COLORS: Record<string, string> = {
  FAKEOUT: 'text-red-400 bg-red-500/10 border-red-500/30',
  NEWS_DRIVEN: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  OVEREXTENDED: 'text-red-400 bg-red-500/10 border-red-500/30',
  SECTOR_HEADWIND: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  LIQUIDITY_TRAP: 'text-red-400 bg-red-500/10 border-red-500/30',
  CLEAR: 'text-green-400 bg-green-500/10 border-green-500/30',
}

export default function PickCard({
  pick,
  onLogTrade,
}: {
  pick: PickData
  onLogTrade: (pick: PickData) => void
}) {
  const [portfolio, setPortfolio] = useState('100000')
  const [showPositionSize, setShowPositionSize] = useState(false)
  const [posSize, setPosSize] = useState<{ size: number; value: number; risk: number } | null>(null)

  const scoreColor = pick.score >= 7 ? 'text-green-400' : pick.score >= 5 ? 'text-yellow-400' : 'text-red-400'
  const scoreBg = pick.score >= 7 ? 'border-green-500/40 bg-green-500/5' : pick.score >= 5 ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-red-500/40 bg-red-500/5'
  const confColor = pick.confidence === 'HIGH' ? 'text-green-400' : pick.confidence === 'MEDIUM' ? 'text-yellow-400' : 'text-red-400'

  const symbolClean = pick.symbol.replace('.NS', '')

  const calcPositionSize = () => {
    const p = parseFloat(portfolio) || 0
    const entry = pick.entry_high
    const sl = pick.stop_loss
    if (p > 0 && entry > sl) {
      const riskAmt = p * 0.02
      const riskPerShare = entry - sl
      const size = riskAmt / riskPerShare
      setPosSize({ size, value: size * entry, risk: riskAmt })
      setShowPositionSize(true)
    }
  }

  return (
    <div className={`rounded-lg border p-4 ${scoreBg}`}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-base font-bold text-[var(--text-primary)]">{symbolClean}</h4>
            {pick.summary?.sector && (
              <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                {pick.summary.sector.replace('^CNX', '').replace('Nifty ', '')}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span>Close ₹{pick.summary?.close?.toFixed(2) || 'N/A'}</span>
            <span>•</span>
            <span>RSI {pick.summary?.rsi || 'N/A'}</span>
            <span>•</span>
            <span>Vol {pick.summary?.vol_ratio || 1}x</span>
          </div>
        </div>
        {/* Score circle */}
        <div className="flex flex-col items-center">
          <div className={`flex h-14 w-14 items-center justify-center rounded-full border-2 ${scoreColor}`}>
            <span className="text-xl font-bold">{pick.score}</span>
          </div>
          <span className="mt-0.5 text-[9px] uppercase text-[var(--text-secondary)]">AI Score</span>
        </div>
      </div>

      {/* Method badges */}
      <div className="mb-3 flex flex-wrap gap-1">
        {pick.methods_triggered.map((m) => (
          <span key={m} className="rounded bg-[var(--blue)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--blue)]">
            {m}
          </span>
        ))}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confColor === 'text-green-400' ? 'bg-green-500/20' : confColor === 'text-yellow-400' ? 'bg-yellow-500/20' : 'bg-red-500/20'} ${confColor}`}>
          {pick.confidence}
        </span>
      </div>

      {/* Level chips */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        <LevelChip label="Entry" value={`₹${pick.entry_low.toFixed(0)}-${pick.entry_high.toFixed(0)}`} color="text-blue-400" />
        <LevelChip label="SL" value={`₹${pick.stop_loss.toFixed(0)}`} color="text-red-400" />
        <LevelChip label="T1" value={`₹${pick.target_1.toFixed(0)}`} color="text-green-400" />
        <LevelChip label="T2" value={`₹${pick.target_2.toFixed(0)}`} color="text-green-400" />
      </div>

      {/* Tags */}
      {pick.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {pick.tags.map((t) => (
            <span key={t} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TAG_COLORS[t] || 'bg-gray-500/20 text-gray-400'}`}>
              {t.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Risk */}
      <div className={`mb-3 rounded border px-3 py-2 ${RISK_COLORS[pick.risk_tag] || RISK_COLORS['CLEAR']}`}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase">{pick.risk_tag}</span>
          <span className="text-xs">{pick.key_risk}</span>
        </div>
      </div>

      {/* Hold time + position sizing */}
      <div className="mb-3 flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>⏱ Hold: {pick.hold_days_min}-{pick.hold_days_max} days</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={portfolio}
            onChange={(e) => setPortfolio(e.target.value)}
            className="w-20 rounded bg-[var(--bg-hover)] px-2 py-1 text-xs text-[var(--text-primary)]"
            placeholder="Portfolio ₹"
          />
          <button
            onClick={calcPositionSize}
            className="rounded bg-[var(--bg-hover)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Size
          </button>
        </div>
      </div>

      {showPositionSize && posSize && (
        <div className="mb-3 rounded bg-[var(--bg-tertiary)] p-2 text-xs">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-sm font-bold text-[var(--text-primary)]">{posSize.size.toFixed(0)} shares</div>
              <div className="text-[9px] uppercase text-[var(--text-secondary)]">Position Size</div>
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--text-primary)]">₹{posSize.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              <div className="text-[9px] uppercase text-[var(--text-secondary)]">Position Value</div>
            </div>
            <div>
              <div className="text-sm font-bold text-red-400">₹{posSize.risk.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              <div className="text-[9px] uppercase text-[var(--text-secondary)]">Risk (2%)</div>
            </div>
          </div>
        </div>
      )}

      {/* Log trade button */}
      <button
        onClick={() => onLogTrade(pick)}
        className="w-full rounded-lg bg-[var(--blue)] py-2 text-xs font-medium text-white hover:bg-[var(--blue)]/80"
      >
        📝 Log This Trade
      </button>
    </div>
  )
}

function LevelChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-tertiary)] p-2 text-center">
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-[9px] uppercase text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}

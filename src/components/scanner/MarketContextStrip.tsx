'use client'

import { useState, useEffect, useCallback } from 'react'

interface MarketContext {
  nifty_close: number
  nifty_change_pct: number
  vix: number
  fii_net: number
  dii_net: number
  regime: string
}

export default function MarketContextStrip({ refreshKey }: { refreshKey?: number }) {
  const [ctx, setCtx] = useState<MarketContext | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCtx = useCallback(async () => {
    try {
      const res = await fetch('/scanner/api/context')
      if (res.ok) setCtx(await res.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCtx()
  }, [fetchCtx, refreshKey])

  if (loading || !ctx) {
    return (
      <div className="flex items-center gap-4 rounded-lg bg-[var(--bg-secondary)] px-4 py-2 text-xs text-[var(--text-secondary)]">
        Loading market context...
      </div>
    )
  }

  const vixColor = ctx.vix < 15 ? 'text-green-400' : ctx.vix <= 20 ? 'text-yellow-400' : 'text-red-400'
  const vixBg = ctx.vix < 15 ? 'bg-green-500/20' : ctx.vix <= 20 ? 'bg-yellow-500/20' : 'bg-red-500/20'
  const regimeColor = ctx.regime === 'BULLISH' ? 'text-green-400 bg-green-500/20'
    : ctx.regime === 'BEARISH' ? 'text-red-400 bg-red-500/20'
    : 'text-yellow-400 bg-yellow-500/20'
  const niftyUp = ctx.nifty_change_pct >= 0

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-2">
      {/* Nifty */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-[var(--text-secondary)]">Nifty 50</span>
        <span className="text-sm font-bold text-[var(--text-primary)]">{ctx.nifty_close.toLocaleString('en-IN')}</span>
        <span className={`text-xs font-medium ${niftyUp ? 'text-green-400' : 'text-red-400'}`}>
          {niftyUp ? '▲' : '▼'} {Math.abs(ctx.nifty_change_pct).toFixed(2)}%
        </span>
      </div>

      <div className="h-4 w-px bg-[var(--border-color)]" />

      {/* VIX */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-[var(--text-secondary)]">VIX</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${vixBg} ${vixColor}`}>{ctx.vix.toFixed(2)}</span>
      </div>

      <div className="h-4 w-px bg-[var(--border-color)]" />

      {/* FII */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-[var(--text-secondary)]">FII</span>
        <span className={`text-xs font-medium ${ctx.fii_net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {ctx.fii_net >= 0 ? '+' : ''}₹{Math.abs(ctx.fii_net).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr
        </span>
      </div>

      <div className="h-4 w-px bg-[var(--border-color)]" />

      {/* DII */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-[var(--text-secondary)]">DII</span>
        <span className={`text-xs font-medium ${ctx.dii_net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {ctx.dii_net >= 0 ? '+' : ''}₹{Math.abs(ctx.dii_net).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr
        </span>
      </div>

      <div className="ml-auto">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${regimeColor}`}>
          {ctx.regime === 'BULLISH' ? '🟢' : ctx.regime === 'BEARISH' ? '🔴' : '🟡'} {ctx.regime}
        </span>
      </div>
    </div>
  )
}

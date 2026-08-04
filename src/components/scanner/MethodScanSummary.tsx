'use client'

import { useState, useEffect, useCallback } from 'react'

interface MethodDef {
  id: string
  name: string
  desc: string
}

interface MethodState {
  methods_fired: Record<string, number>
}

const METHOD_DEFS: MethodDef[] = [
  { id: 'M1', name: 'Breakout + Volume', desc: '52W high breakout with volume confirmation' },
  { id: 'M2', name: 'Supertrend + MACD', desc: 'Bullish supertrend + MACD crossover' },
  { id: 'M3', name: 'RSI Reversal', desc: 'Exit from oversold zone + bullish candle' },
  { id: 'M4', name: 'EMA Crossover', desc: 'Fresh 20/50 EMA bullish crossover' },
  { id: 'M5', name: 'Sector Momentum', desc: 'Stock in top-2 momentum sectors' },
  { id: 'M6', name: 'Bullish Engulfing', desc: 'Engulfing pattern near 50EMA support' },
  { id: 'M7', name: 'AI Composite', desc: 'Claude AI multi-factor scoring' },
]

export default function MethodScanSummary({
  methodsFired,
}: {
  methodsFired: Record<string, number>
}) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
      <h3 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">7-Method Scan Summary</h3>
      <div className="space-y-1">
        {METHOD_DEFS.map((m) => {
          const fired = (methodsFired[m.id] || 0) > 0
          const count = methodsFired[m.id] || 0
          const dotColor = fired ? 'bg-green-500' : 'bg-gray-500'
          return (
            <div key={m.id} className="flex items-center gap-2 rounded bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
              <span className="w-8 shrink-0 font-bold text-[var(--blue)]">{m.id}</span>
              <span className="flex-1 text-[var(--text-primary)]">{m.name}</span>
              <span className="text-[var(--text-secondary)]">{m.desc}</span>
              {count > 0 && (
                <span className="shrink-0 rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                  {count} hits
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

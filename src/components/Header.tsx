'use client'

import { useEffect, useState } from 'react'
import { INSTRUMENTS, getInstrument } from '@/types'
import { useCurrency } from '@/lib/currency'

interface HeaderProps {
  symbol: string
  onSymbolChange: (s: string) => void
  refreshKey: number
}

interface TickerData {
  price: number
}

export default function Header({ symbol, onSymbolChange, refreshKey }: HeaderProps) {
  const [ticker, setTicker] = useState<TickerData | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const inst = getInstrument(symbol)

  useEffect(() => {
    const fetchTicker = async () => {
      try {
        const res = await fetch(`/api/ticker/${symbol}`)
        const json = await res.json()
        if (json.data) {
          setTicker({ price: json.data.price })
        }
      } catch {
        // ignore
      }
    }

    fetchTicker()
    const interval = setInterval(fetchTicker, 10000)
    return () => clearInterval(interval)
  }, [symbol, refreshKey])

  const { fmt } = useCurrency()

  return (
    <header className="flex items-center gap-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold tracking-tight">
          <span className="text-[var(--blue)]">Trade</span>Sim
        </span>
        <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-medium uppercase text-[var(--yellow)]">
          Swing Strategy
        </span>
      </div>

      {/* Symbol selector */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2 rounded-md bg-[var(--bg-tertiary)] px-3 py-1.5 font-semibold hover:bg-[var(--bg-hover)]"
        >
          {inst?.label ?? symbol}
          <span className="text-xs text-[var(--text-secondary)]">{inst?.exchange}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] py-1 shadow-xl">
              {INSTRUMENTS.map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => {
                    onSymbolChange(s.symbol)
                    setDropdownOpen(false)
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left hover:bg-[var(--bg-hover)] ${
                    s.symbol === symbol ? 'text-[var(--blue)]' : ''
                  }`}
                >
                  <span>
                    {s.label}
                    <span className="ml-2 text-xs text-[var(--text-secondary)]">{s.exchange}</span>
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                    s.currency === 'INR' ? 'bg-orange-900/30 text-orange-400' : 'bg-green-900/30 text-green-400'
                  }`}>
                    {s.currency}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Price info */}
      {ticker && inst && (
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-xl font-bold tabular-nums">
              {fmt(ticker.price ?? 0, { decimals: 2 })}
            </span>
          </div>
        </div>
      )}
    </header>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { getInstrument, INSTRUMENTS } from '@/types'
import { useCurrency } from '@/lib/currency'

interface HoldingsTabProps {
  refreshKey: number
  onTradeComplete: () => void
}

interface Position {
  id: number
  symbol: string
  side: string
  entryPrice: number
  quantity: number
  createdAt: string
}

interface PriceInfo {
  native: number
  currency: string
}

interface TradeRecord {
  id: number
  symbol: string
  side: string
  price: number
  quantity: number
  createdAt: string
}

export default function HoldingsTab({ refreshKey, onTradeComplete }: HoldingsTabProps) {
  const [positions, setPositions] = useState<Position[]>([])
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({})
  const [tab, setTab] = useState<'open' | 'closed' | 'all-stocks'>('open')
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const { fmt, convert, symbol } = useCurrency()

  const fetchData = useCallback(async () => {
    try {
      const [posRes, tradeRes] = await Promise.all([
        fetch('/api/positions'),
        fetch('/api/trades'),
      ])
      const posJson = await posRes.json()
      const tradeJson = await tradeRes.json()
      if (posJson.data) setPositions(posJson.data)
      if (tradeJson.data) setTrades(tradeJson.data)
    } catch {}
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [refreshKey, fetchData])

  useEffect(() => {
    if (positions.length === 0) return
    const poll = async () => {
      const newPrices: Record<string, PriceInfo> = {}
      await Promise.all(positions.map(async (p) => {
        try {
          const res = await fetch(`/api/ticker/${p.symbol}`)
          const json = await res.json()
          if (json.data) {
            const inst = getInstrument(p.symbol)
            newPrices[p.symbol] = { native: json.data.nativePrice, currency: inst?.currency ?? 'INR' }
          }
        } catch {}
      }))
      setPrices(newPrices)
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [positions.map((p) => p.symbol).join(',')])

  const handleClose = async (sym: string) => {
    await fetch('/api/positions/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }) })
    onTradeComplete()
    fetchData()
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex gap-1 border-b border-[var(--border-color)] px-3 py-2">
        {(['open', 'closed', 'all-stocks'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${tab === t ? 'bg-[var(--blue)]/20 text-[var(--blue)]' : 'text-[var(--text-secondary)]'}`}>
            {t === 'open' ? `Open Positions (${positions.length})` : t === 'closed' ? 'Trade History' : 'All Nifty 50 Stocks'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'open' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-2 text-left">Symbol</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-right">Entry ({symbol})</th>
                <th className="px-4 py-2 text-right">Mark ({symbol})</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Value</th>
                <th className="px-4 py-2 text-right">P&L</th>
                <th className="px-4 py-2 text-right">P&L %</th>
                <th className="px-4 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-[var(--text-secondary)]">No open positions</td></tr>
              ) : positions.map((pos) => {
                const mark = prices[pos.symbol]?.native ?? pos.entryPrice
                const pnlUsd = (mark - pos.entryPrice) * pos.quantity
                const pnlPct = pos.entryPrice > 0 ? ((mark - pos.entryPrice) / pos.entryPrice) * 100 : 0
                const valueUsd = mark * pos.quantity
                const inst = getInstrument(pos.symbol)
                return (
                  <tr key={pos.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                    <td className="px-4 py-2 font-medium">{inst?.base ?? pos.symbol}</td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">{inst?.label ?? pos.symbol}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{convert(pos.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{convert(mark).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pos.quantity.toFixed(4)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(valueUsd, { decimals: 0 })}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${pnlUsd >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{pnlUsd >= 0 ? '+' : '-'}{fmt(Math.abs(pnlUsd), { decimals: 0 })}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${pnlPct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</td>
                    <td className="px-4 py-2 text-center"><button onClick={() => handleClose(pos.symbol)} className="rounded bg-[var(--red)]/20 px-2 py-1 text-[var(--red)] hover:bg-[var(--red)]/30">Close</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {tab === 'closed' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-2 text-left">Symbol</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-center">Side</th>
                <th className="px-4 py-2 text-right">Price ({symbol})</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Value</th>
                <th className="px-4 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-[var(--text-secondary)]">No trades yet</td></tr>
              ) : trades.map((t) => {
                const inst = getInstrument(t.symbol)
                return (
                  <tr key={t.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                    <td className="px-4 py-2 font-medium">{inst?.base ?? t.symbol}</td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">{inst?.label ?? t.symbol}</td>
                    <td className={`px-4 py-2 text-center ${t.side === 'buy' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{t.side.toUpperCase()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{convert(t.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{t.quantity.toFixed(4)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(t.price * t.quantity, { decimals: 0 })}</td>
                    <td className="px-4 py-2 text-right text-[var(--text-secondary)]">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {tab === 'all-stocks' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Symbol</th>
                <th className="px-4 py-2 text-left">Company Name</th>
                <th className="px-4 py-2 text-left">Sector</th>
                <th className="px-4 py-2 text-left">Exchange</th>
              </tr>
            </thead>
            <tbody>
              {INSTRUMENTS.filter((s) => s.index !== 'INDEX').map((inst, i) => (
                <tr key={inst.symbol} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">{inst.base}</td>
                  <td className="px-4 py-2">{inst.label}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{inst.sector}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{inst.exchange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

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

interface ClosedTrade {
  id: number
  symbol: string
  side: string
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  pnlPct: number
  openedAt: string
  closedAt: string
  exitReason?: string | null
  holdDuration?: number | null
}

function formatHeldFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function formatHoldMinutes(mins: number | null | undefined): string {
  if (mins == null || !Number.isFinite(mins)) return '—'
  return formatHeldFromMs(mins * 60000)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HoldingsTab({ refreshKey, onTradeComplete }: HoldingsTabProps) {
  const [positions, setPositions] = useState<Position[]>([])
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({})
  const [tab, setTab] = useState<'open' | 'closed' | 'all-stocks'>('open')
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([])
  const { fmt, convert } = useCurrency()

  const fetchData = useCallback(async () => {
    try {
      const [posRes, closedRes] = await Promise.all([
        fetch('/api/positions'),
        fetch('/api/trades/closed'),
      ])
      const posJson = await posRes.json()
      const closedJson = await closedRes.json()
      if (posJson.data) setPositions(posJson.data)
      if (closedJson.data) setClosedTrades(closedJson.data)
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

  const colHeader =
    'px-3 py-2 text-[var(--text-secondary)] font-medium whitespace-nowrap'

  /** Trade History = open positions + closed trades, with OPEN / CLOSED status. */
  type HistoryRow = {
    key: string
    status: 'OPEN' | 'CLOSED'
    symbol: string
    openedAt: string
    closedAt: string | null
    entryPrice: number
    exitPrice: number
    quantity: number
    pnl: number
    pnlPct: number
    held: string
  }

  const historyRows: HistoryRow[] = [
    ...positions.map((pos) => {
      const mark = prices[pos.symbol]?.native ?? pos.entryPrice
      const pnl = (mark - pos.entryPrice) * pos.quantity
      const pnlPct = pos.entryPrice > 0 ? ((mark - pos.entryPrice) / pos.entryPrice) * 100 : 0
      return {
        key: `open-${pos.id}`,
        status: 'OPEN' as const,
        symbol: pos.symbol,
        openedAt: pos.createdAt,
        closedAt: null,
        entryPrice: pos.entryPrice,
        exitPrice: mark,
        quantity: pos.quantity,
        pnl,
        pnlPct,
        held: formatHeldFromMs(Date.now() - new Date(pos.createdAt).getTime()),
      }
    }),
    ...closedTrades.map((t) => ({
      key: `closed-${t.id}`,
      status: 'CLOSED' as const,
      symbol: t.symbol,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      quantity: t.quantity,
      pnl: t.pnl,
      pnlPct: t.pnlPct,
      held:
        formatHoldMinutes(t.holdDuration) !== '—'
          ? formatHoldMinutes(t.holdDuration)
          : formatHeldFromMs(new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()),
    })),
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex gap-1 border-b border-[var(--border-color)] px-3 py-2">
        {(['open', 'closed', 'all-stocks'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${tab === t ? 'bg-[var(--blue)]/20 text-[var(--blue)]' : 'text-[var(--text-secondary)]'}`}>
            {t === 'open'
              ? `Open Positions (${positions.length})`
              : t === 'closed'
                ? `Trade History (${historyRows.length})`
                : 'All Nifty 50 Stocks'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {tab === 'open' && (
          <table className="w-full min-w-[960px] text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)]">
              <tr>
                <th className={`${colHeader} text-left`}>Symbol</th>
                <th className={`${colHeader} text-left`}>Name</th>
                <th className={`${colHeader} text-left`}>Time</th>
                <th className={`${colHeader} text-right`}>Entry (₹)</th>
                <th className={`${colHeader} text-right`}>Mark (₹)</th>
                <th className={`${colHeader} text-right`}>Qty</th>
                <th className={`${colHeader} text-right`}>Value</th>
                <th className={`${colHeader} text-right`}>P&L</th>
                <th className={`${colHeader} text-right`}>P&L %</th>
                <th className={`${colHeader} text-right`}>Held</th>
                <th className={`${colHeader} text-center`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 ? (
                <tr><td colSpan={11} className="py-8 text-center text-[var(--text-secondary)]">No open positions</td></tr>
              ) : positions.map((pos) => {
                const mark = prices[pos.symbol]?.native ?? pos.entryPrice
                const pnlUsd = (mark - pos.entryPrice) * pos.quantity
                const pnlPct = pos.entryPrice > 0 ? ((mark - pos.entryPrice) / pos.entryPrice) * 100 : 0
                const valueUsd = mark * pos.quantity
                const inst = getInstrument(pos.symbol)
                const held = formatHeldFromMs(Date.now() - new Date(pos.createdAt).getTime())
                return (
                  <tr key={pos.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                    <td className="px-3 py-2 font-medium">{inst?.base ?? pos.symbol}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{inst?.label ?? pos.symbol}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{formatTime(pos.createdAt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{convert(pos.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{convert(mark).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pos.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(valueUsd, { decimals: 0 })}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pnlUsd >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{pnlUsd >= 0 ? '+' : '-'}{fmt(Math.abs(pnlUsd), { decimals: 0 })}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pnlPct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{held}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => handleClose(pos.symbol)} className="rounded bg-[var(--red)]/20 px-2 py-1 text-[var(--red)] hover:bg-[var(--red)]/30">Close</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {tab === 'closed' && (
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)]">
              <tr>
                <th className={`${colHeader} text-left`}>Status</th>
                <th className={`${colHeader} text-left`}>Symbol</th>
                <th className={`${colHeader} text-left`}>Name</th>
                <th className={`${colHeader} text-left`}>Opened</th>
                <th className={`${colHeader} text-left`}>Closed</th>
                <th className={`${colHeader} text-right`}>Entry (₹)</th>
                <th className={`${colHeader} text-right`}>Exit (₹)</th>
                <th className={`${colHeader} text-right`}>Qty</th>
                <th className={`${colHeader} text-right`}>Value</th>
                <th className={`${colHeader} text-right`}>P&L</th>
                <th className={`${colHeader} text-right`}>P&L %</th>
                <th className={`${colHeader} text-right`}>Held</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length === 0 ? (
                <tr><td colSpan={12} className="py-8 text-center text-[var(--text-secondary)]">No trades yet</td></tr>
              ) : historyRows.map((row) => {
                const inst = getInstrument(row.symbol)
                const value = row.exitPrice * row.quantity
                return (
                  <tr key={row.key} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        row.status === 'OPEN'
                          ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">{inst?.base ?? row.symbol}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{inst?.label ?? row.symbol}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{formatTime(row.openedAt)}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">
                      {row.closedAt ? formatTime(row.closedAt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{convert(row.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{convert(row.exitPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(value, { decimals: 0 })}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                      {row.pnl >= 0 ? '+' : '-'}{fmt(Math.abs(row.pnl), { decimals: 0 })}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.pnlPct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                      {row.pnlPct >= 0 ? '+' : ''}{row.pnlPct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{row.held}</td>
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

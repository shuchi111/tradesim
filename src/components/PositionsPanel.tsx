'use client'

import { useEffect, useState, useCallback } from 'react'
import { getInstrument } from '@/types'
import { useCurrency } from '@/lib/currency'

interface PositionsPanelProps {
  symbol: string
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

interface Prices {
  [symbol: string]: { native: number; currency: string }
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

export default function PositionsPanel({ symbol: _symbol, refreshKey, onTradeComplete }: PositionsPanelProps) {
  const [positions, setPositions] = useState<Position[]>([])
  const [prices, setPrices] = useState<Prices>({})
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions')
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([])

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/positions')
      const json = await res.json()
      if (json.data) setPositions(json.data)
    } catch {
      // ignore
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/trades/closed')
      const json = await res.json()
      if (json.data) setClosedTrades(json.data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchPositions()
    fetchHistory()
    const interval = setInterval(() => {
      fetchPositions()
      fetchHistory()
    }, 5000)
    return () => clearInterval(interval)
  }, [refreshKey, fetchPositions, fetchHistory])

  useEffect(() => {
    if (positions.length === 0) return

    const poll = async () => {
      const newPrices: Prices = {}
      await Promise.all(
        positions.map(async (p) => {
          try {
            const res = await fetch(`/api/ticker/${p.symbol}`)
            const json = await res.json()
            if (json.data) {
              const inst = getInstrument(p.symbol)
              newPrices[p.symbol] = {
                native: json.data.nativePrice,
                currency: inst?.currency ?? 'INR',
              }
            }
          } catch {
            // skip
          }
        })
      )
      setPrices(newPrices)
    }

    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [positions.map((p) => p.symbol).join(',')])

  const handleClose = async (posSymbol: string) => {
    try {
      const res = await fetch('/api/positions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: posSymbol }),
      })
      const json = await res.json()
      if (json.error) {
        alert(json.error)
      } else {
        onTradeComplete()
        fetchPositions()
        fetchHistory()
      }
    } catch {
      alert('Failed to close position')
    }
  }

  const { fmt, convert } = useCurrency()
  const getLabel = (sym: string) => getInstrument(sym)?.base ?? sym
  const getName = (sym: string) => getInstrument(sym)?.label ?? sym
  const colHeader = 'px-2 py-2 text-[var(--text-secondary)] font-medium whitespace-nowrap'

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-r border-[var(--border-color)]">
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1">
        <button
          onClick={() => setActiveTab('positions')}
          className={`rounded px-3 py-1 text-xs font-medium ${
            activeTab === 'positions' ? 'bg-[var(--bg-hover)] text-[var(--blue)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          Positions ({positions.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`rounded px-3 py-1 text-xs font-medium ${
            activeTab === 'history' ? 'bg-[var(--bg-hover)] text-[var(--blue)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          History ({closedTrades.length})
        </button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {activeTab === 'positions' ? (
          positions.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
              No open positions
            </div>
          ) : (
            <table className="w-full min-w-[900px] text-xs">
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
                {positions.map((pos) => {
                  const markUsd = prices[pos.symbol]?.native ?? pos.entryPrice
                  const pnlUsd = (markUsd - pos.entryPrice) * pos.quantity
                  const pnlPercent = pos.entryPrice > 0
                    ? ((markUsd - pos.entryPrice) / pos.entryPrice) * 100
                    : 0
                  const valueUsd = markUsd * pos.quantity
                  const held = formatHeldFromMs(Date.now() - new Date(pos.createdAt).getTime())
                  return (
                    <tr key={pos.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                      <td className="px-2 py-2 font-medium">{getLabel(pos.symbol)}</td>
                      <td className="px-2 py-2 text-[var(--text-secondary)]">{getName(pos.symbol)}</td>
                      <td className="px-2 py-2 text-[var(--text-secondary)] whitespace-nowrap">{formatTime(pos.createdAt)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{convert(pos.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{convert(markUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{pos.quantity}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmt(valueUsd, { decimals: 0 })}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${pnlUsd >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {pnlUsd >= 0 ? '+' : '-'}{fmt(Math.abs(pnlUsd), { decimals: 0 })}
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums ${pnlPercent >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-[var(--text-secondary)]">{held}</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => handleClose(pos.symbol)}
                          className="rounded bg-[var(--red)]/20 px-2 py-1 text-[var(--red)] hover:bg-[var(--red)]/30"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          closedTrades.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
              No trade history yet
            </div>
          ) : (
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
                {closedTrades.map((trade) => {
                  const value = trade.exitPrice * trade.quantity
                  const status = (trade.side || 'long').toLowerCase() === 'short' ? 'BUY' : 'SELL'
                  const held =
                    formatHoldMinutes(trade.holdDuration) !== '—'
                      ? formatHoldMinutes(trade.holdDuration)
                      : formatHeldFromMs(
                          new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()
                        )
                  return (
                    <tr key={trade.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                      <td className="px-2 py-2">
                        <span className="rounded bg-[var(--blue)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--blue)]">
                          {status}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-medium">{getLabel(trade.symbol)}</td>
                      <td className="px-2 py-2 text-[var(--text-secondary)]">{getName(trade.symbol)}</td>
                      <td className="px-2 py-2 text-[var(--text-secondary)] whitespace-nowrap">{formatTime(trade.openedAt)}</td>
                      <td className="px-2 py-2 text-[var(--text-secondary)] whitespace-nowrap">{formatTime(trade.closedAt)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{convert(trade.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{convert(trade.exitPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{trade.quantity}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmt(value, { decimals: 0 })}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${trade.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {trade.pnl >= 0 ? '+' : '-'}{fmt(Math.abs(trade.pnl), { decimals: 0 })}
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums ${trade.pnlPct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-[var(--text-secondary)]">{held}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}

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
  entryPrice: number  // stored in INR
  quantity: number
  createdAt: string
}

interface TradeRecord {
  id: number
  symbol: string
  side: string
  price: number
  quantity: number
  createdAt: string
}

interface Prices {
  [symbol: string]: { native: number; currency: string }
}

export default function PositionsPanel({ symbol: _symbol, refreshKey, onTradeComplete }: PositionsPanelProps) {
  const [positions, setPositions] = useState<Position[]>([])
  const [prices, setPrices] = useState<Prices>({})
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions')
  const [history, setHistory] = useState<TradeRecord[]>([])

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
      const res = await fetch('/api/trades')
      const json = await res.json()
      if (json.data) setHistory(json.data)
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

  // Poll for live prices
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
      }
    } catch {
      alert('Failed to close position')
    }
  }

  const { fmt, convert, symbol } = useCurrency()
  const getLabel = (sym: string) => getInstrument(sym)?.base ?? sym

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
          History
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'positions' ? (
          positions.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
              No open positions
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-right font-medium">Entry (₹)</th>
                  <th className="px-3 py-2 text-right font-medium">Mark (₹)</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">P&L</th>
                  <th className="px-3 py-2 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const markUsd = prices[pos.symbol]?.native ?? pos.entryPrice
                  const pnlUsd = (markUsd - pos.entryPrice) * pos.quantity
                  const pnlPercent = pos.entryPrice > 0
                    ? ((markUsd - pos.entryPrice) / pos.entryPrice) * 100
                    : 0
                  return (
                    <tr key={pos.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                      <td className="px-3 py-2 font-medium">{getLabel(pos.symbol)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{convert(pos.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{convert(markUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pos.quantity}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${pnlUsd >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {pnlUsd >= 0 ? '+' : '-'}{fmt(Math.abs(pnlUsd), { decimals: 0 })}
                        <div className="text-[10px]">
                          ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
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
          history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
              No trade history yet
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-center font-medium">Side</th>
                  <th className="px-3 py-2 text-right font-medium">Price ({symbol})</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((trade) => (
                  <tr key={trade.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                    <td className="px-3 py-2 font-medium">{getLabel(trade.symbol)}</td>
                    <td className={`px-3 py-2 text-center ${trade.side === 'buy' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                      {trade.side.toUpperCase()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{convert(trade.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{trade.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(trade.price * trade.quantity, { decimals: 0 })}</td>
                    <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                      {new Date(trade.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}

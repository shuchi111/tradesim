'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCurrency } from '@/lib/currency'

interface WalletData {
  balance: number
  equity: number
  positionsValue: number
  unrealizedPnl: number
  startingEquity: number
  sipAmountInr: number
  sipDayOfMonth?: number
  sipEligibleFrom?: string | null
  lastSipDate: string | null
}

interface Position {
  id: number
  symbol: string
  quantity: number
  entryPrice: number
  side: string
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

interface PriceInfo {
  native: number
  currency: string
}

export default function WalletTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({})
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState(false)
  const { fmt, convert, symbol } = useCurrency()

  const handleReset = async () => {
    if (
      !confirm(
        'Reset portfolio to ₹1,00,000? This clears open positions and pending orders. SIP of ₹20,000 runs on the 7th of each month (IST).'
      )
    ) {
      return
    }
    setResetting(true)
    try {
      const res = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      })
      const json = await res.json()
      if (json.error) {
        alert(json.error)
      } else {
        await fetchData()
      }
    } catch {
      alert('Reset failed')
    } finally {
      setResetting(false)
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const [acctRes, posRes, trdRes] = await Promise.all([
        fetch('/api/account'),
        fetch('/api/positions'),
        fetch('/api/trades'),
      ])
      const acctJson = await acctRes.json()
      const posJson = await posRes.json()
      const trdJson = await trdRes.json()
      if (acctJson.data) setWallet(acctJson.data)
      if (posJson.data) setPositions(posJson.data)
      if (trdJson.data) setTrades(trdJson.data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData, refreshKey])

  // Poll prices for open positions
  useEffect(() => {
    if (positions.length === 0) return
    const poll = async () => {
      const newPrices: Record<string, PriceInfo> = {}
      await Promise.all(positions.map(async (p) => {
        try {
          const res = await fetch(`/api/ticker/${p.symbol}`)
          const json = await res.json()
          if (json.data) {
            newPrices[p.symbol] = {
              native: json.data.nativePrice,
              currency: json.data.currency || 'INR',
            }
          }
        } catch {
          // skip
        }
      }))
      setPrices(newPrices)
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [positions.map((p) => p.symbol).join(',')])

  if (loading && !wallet) {
    return <div className="p-8 text-center text-[var(--text-secondary)]">Loading wallet…</div>
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">👛 Wallet</h2>
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          {resetting ? 'Resetting…' : 'Reset to ₹1,00,000'}
        </button>
      </div>

      {/* Cash Balance Cards */}
      {wallet && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--green)]/30 bg-[var(--green)]/5 p-5">
            <div className="text-xs text-[var(--text-secondary)]">Available Cash</div>
            <div className="mt-1 text-2xl font-bold text-[var(--green)]">
              {fmt(wallet.balance, { decimals: 0 })}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--blue)]/30 bg-[var(--blue)]/5 p-5">
            <div className="text-xs text-[var(--text-secondary)]">Total Equity (Cash + Positions)</div>
            <div className="mt-1 text-2xl font-bold text-[var(--blue)]">
              {fmt(wallet.equity, { decimals: 0 })}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5">
            <div className="text-xs text-[var(--text-secondary)]">Position Value</div>
            <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {fmt(wallet.positionsValue, { decimals: 0 })}
            </div>
          </div>
        </div>
      )}

      {/* SIP & Sell Penalty Info */}
      {wallet && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* SIP Card */}
          <div className="rounded-lg border border-[var(--green)]/30 bg-[var(--green)]/5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--text-secondary)]">📅 Monthly SIP</div>
                <div className="mt-1 text-2xl font-bold text-[var(--green)]">
                  ₹{wallet.sipAmountInr.toLocaleString('en-IN')}
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  On the {wallet.sipDayOfMonth ?? 7}th of each month (IST)
                </div>
              </div>
            </div>
            <div className="mt-2 border-t border-[var(--green)]/20 pt-2">
              <div className="text-xs text-[var(--text-secondary)]">
                {wallet.lastSipDate
                  ? `Last deposit: ${new Date(wallet.lastSipDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : 'No SIP deposit yet'}
              </div>
              <div className="text-xs text-[var(--green)]">
                Next deposit: {(() => {
                  const day = wallet.sipDayOfMonth ?? 7
                  const eligible = wallet.sipEligibleFrom
                    ? new Date(wallet.sipEligibleFrom)
                    : new Date()
                  const last = wallet.lastSipDate ? new Date(wallet.lastSipDate) : null
                  const base = last && last > eligible ? last : eligible
                  const next = new Date(base.getFullYear(), base.getMonth() + (last ? 1 : 0), day)
                  // If still in eligibility month without a deposit, use eligible month's day
                  if (!last && wallet.sipEligibleFrom) {
                    const e = new Date(wallet.sipEligibleFrom)
                    return new Date(e.getFullYear(), e.getMonth(), day).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  }
                  return next.toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                })()}
              </div>
            </div>
          </div>

          {/* Sell Penalty Card */}
          <div className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 p-5">
            <div className="text-xs text-[var(--text-secondary)]">📉 Sell Penalty</div>
            <div className="mt-1 text-2xl font-bold text-[var(--red)]">₹150</div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              Flat ₹150 charged on every sell. Money is permanently lost from the wallet.
            </div>
          </div>

          {/* Starting Balance Card */}
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5">
            <div className="text-xs text-[var(--text-secondary)]">🏁 Starting Balance</div>
            <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {fmt(wallet.startingEquity, { decimals: 0 })}
            </div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              ₹1,00,000 (1 Lakh INR at launch)
            </div>
          </div>
        </div>
      )}

      {/* Unrealized P&L */}
      {wallet && (
        <div className="mb-6">
          <div className={`rounded-lg border p-4 ${wallet.unrealizedPnl >= 0 ? 'border-[var(--green)]/30 bg-[var(--green)]/5' : 'border-[var(--red)]/30 bg-[var(--red)]/5'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--text-secondary)]">Unrealized P&L</div>
                <div className={`text-xl font-bold ${wallet.unrealizedPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {wallet.unrealizedPnl >= 0 ? '+' : '-'}{fmt(Math.abs(wallet.unrealizedPnl), { decimals: 0 })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[var(--text-secondary)]">Open Positions</div>
                <div className="text-lg font-bold text-[var(--text-primary)]">{positions.length}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Position Breakdown */}
      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Investments — Open Positions</h3>
        {positions.length === 0 ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 text-center text-sm text-[var(--text-secondary)]">
            No open positions
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                  <th className="py-2 text-left">Instrument</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Entry ({symbol})</th>
                  <th className="py-2 text-right">Current ({symbol})</th>
                  <th className="py-2 text-right">Market Value</th>
                  <th className="py-2 text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const mark = prices[pos.symbol]?.native ?? pos.entryPrice
                  const pnlUsd = (mark - pos.entryPrice) * pos.quantity
                  const pnlPct = pos.entryPrice > 0 ? ((mark - pos.entryPrice) / pos.entryPrice) * 100 : 0
                  const marketValueUsd = mark * pos.quantity
                  return (
                    <tr key={pos.id} className="border-b border-[var(--border-color)]/50">
                      <td className="py-2 text-[var(--text-primary)]">{pos.symbol}</td>
                      <td className="py-2 text-right text-[var(--text-secondary)]">{pos.quantity.toFixed(4)}</td>
                      <td className="py-2 text-right text-[var(--text-secondary)]">{convert(pos.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right text-[var(--text-secondary)]">{convert(mark).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right text-[var(--text-primary)]">{fmt(marketValueUsd, { decimals: 0 })}</td>
                      <td className={`py-2 text-right ${pnlUsd >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {pnlUsd >= 0 ? '+' : '-'}{fmt(Math.abs(pnlUsd), { decimals: 0 })}
                        <div className="text-[10px] text-[var(--text-secondary)]">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transaction History */}
      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Transaction History</h3>
        {trades.length === 0 ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 text-center text-sm text-[var(--text-secondary)]">
            No transactions yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Instrument</th>
                  <th className="py-2 text-right">Side</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Price ({symbol})</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-[var(--border-color)]/50">
                    <td className="py-2 text-[var(--text-secondary)]">{new Date(trade.createdAt).toLocaleString()}</td>
                    <td className="py-2 text-[var(--text-primary)]">{trade.symbol}</td>
                    <td className={`py-2 text-right font-medium ${trade.side.toLowerCase() === 'buy' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{trade.side.toUpperCase()}</td>
                    <td className="py-2 text-right text-[var(--text-secondary)]">{trade.quantity.toFixed(4)}</td>
                    <td className="py-2 text-right text-[var(--text-secondary)]">{convert(trade.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right text-[var(--text-primary)]">{fmt(trade.price * trade.quantity, { decimals: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

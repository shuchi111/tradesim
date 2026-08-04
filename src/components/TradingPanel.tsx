'use client'

import { useEffect, useState } from 'react'
import { getInstrument } from '@/types'
import { useCurrency } from '@/lib/currency'

interface TradingPanelProps {
  symbol: string
  onTradeComplete: () => void
}

export default function TradingPanel({ symbol, onTradeComplete }: TradingPanelProps) {
  const { fmt, convert, symbol: curSymbol } = useCurrency()
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [nativePrice, setNativePrice] = useState(0)
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const inst = getInstrument(symbol)

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch(`/api/ticker/${symbol}`)
        const json = await res.json()
        if (json.data) {
          setNativePrice(json.data.nativePrice)
          if (orderType === 'limit' && !limitPrice) {
            setLimitPrice(json.data.nativePrice.toString())
          }
        }
      } catch {
        // ignore
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 10000)
    return () => clearInterval(interval)
  }, [symbol])

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await fetch('/api/account')
        const json = await res.json()
        if (json.data) setBalance(json.data.balance)
      } catch {
        // ignore
      }
    }
    fetchBalance()
  }, [symbol, onTradeComplete])

  const qty = Number(quantity)
  const tradePrice = orderType === 'limit' ? parseFloat(limitPrice) || 0 : nativePrice
  const orderValueUsd = (Number.isFinite(qty) ? qty : 0) * tradePrice

  const handleTrade = async () => {
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      setMessage({ type: 'error', text: 'Enter a whole-share quantity (no decimals)' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          side,
          type: orderType,
          quantity: qty,
          price: orderType === 'limit' ? parseFloat(limitPrice) : undefined,
        }),
      })
      const json = await res.json()

      if (json.error) {
        setMessage({ type: 'error', text: json.error })
      } else {
        const action = orderType === 'limit' && !json.data?.filled
          ? 'Limit order placed'
          : `${side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${inst?.base}`
        setMessage({ type: 'success', text: action })
        setQuantity('')
        onTradeComplete()
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  // Leave 30% cash reserve when sizing % buttons
  const investable = Math.max(0, balance * 0.7)
  const maxQtyNative = nativePrice > 0 ? Math.floor(investable / nativePrice) : 0
  const setPercent = (pct: number) => {
    const q = Math.floor((maxQtyNative * pct) / 100)
    setQuantity(String(Math.max(0, q)))
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
        Place Order
      </h2>

      {/* Instrument info */}
      {inst && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--text-secondary)]">{inst.exchange}</span>
        </div>
      )}

      {/* Order type tabs */}
      <div className="flex rounded-md bg-[var(--bg-tertiary)] p-0.5">
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 rounded py-1.5 text-xs font-medium ${
            orderType === 'market' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          Market
        </button>
        <button
          onClick={() => {
            setOrderType('limit')
            if (!limitPrice && nativePrice) setLimitPrice(nativePrice.toString())
          }}
          className={`flex-1 rounded py-1.5 text-xs font-medium ${
            orderType === 'limit' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          Limit
        </button>
      </div>

      {/* Buy/Sell toggle */}
      <div className="flex rounded-md bg-[var(--bg-tertiary)] p-0.5">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 rounded py-1.5 text-xs font-bold uppercase ${
            side === 'buy' ? 'bg-[var(--green)] text-white' : 'text-[var(--text-secondary)]'
          }`}
        >
          Buy / Long
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 rounded py-1.5 text-xs font-bold uppercase ${
            side === 'sell' ? 'bg-[var(--red)] text-white' : 'text-[var(--text-secondary)]'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Current price */}
      <div className="flex flex-col gap-0.5 text-xs">
        <div className="flex justify-between">
          <span className="text-[var(--text-secondary)]">Market Price</span>
          <span className="tabular-nums">{nativePrice > 0 ? `${convert(nativePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span>
        </div>
      </div>

      {/* Limit price */}
      {orderType === 'limit' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-secondary)]">
            Limit Price (₹)
          </label>
          <input
            type="number"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder="0.00"
            className="rounded-md bg-[var(--bg-tertiary)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--blue)]"
          />
        </div>
      )}

      {/* Quantity */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-secondary)]">
          Quantity — whole shares ({inst?.base})
        </label>
        <input
          type="number"
          step={1}
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))}
          placeholder="0"
          className="rounded-md bg-[var(--bg-tertiary)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--blue)]"
        />
      </div>

      {/* Percentage buttons */}
      <div className="grid grid-cols-4 gap-1">
        {[25, 50, 75, 100].map((pct) => (
          <button
            key={pct}
            onClick={() => setPercent(pct)}
            className="rounded bg-[var(--bg-tertiary)] py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {pct}%
          </button>
        ))}
      </div>

      {/* Order summary */}
      <div className="rounded-md bg-[var(--bg-tertiary)] p-3 text-xs">
        <div className="flex justify-between py-0.5">
          <span className="text-[var(--text-secondary)]">Order Value</span>
          <span className="tabular-nums">{fmt(orderValueUsd, { decimals: 0 })}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-[var(--text-secondary)]">Available</span>
          <span className="tabular-nums">{fmt(balance, { decimals: 0 })}</span>
        </div>
      </div>

      {/* Submit button */}
      <button
        onClick={handleTrade}
        disabled={loading}
        className={`w-full rounded-md py-2.5 text-sm font-bold uppercase transition-colors disabled:opacity-50 ${
          side === 'buy'
            ? 'bg-[var(--green)] text-white hover:opacity-90'
            : 'bg-[var(--red)] text-white hover:opacity-90'
        }`}
      >
        {loading ? 'Processing...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${inst?.base}`}
      </button>

      {message && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            message.type === 'success'
              ? 'bg-green-900/30 text-[var(--green)]'
              : 'bg-red-900/30 text-[var(--red)]'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}

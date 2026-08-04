'use client'

import { useEffect, useState, useCallback } from 'react'
import { getInstrument } from '@/types'

interface OrdersPanelProps {
  refreshKey: number
  onTradeComplete: () => void
}

interface Order {
  id: number
  symbol: string
  side: string
  type: string
  price: number
  quantity: number
  status: string
  createdAt: string
}

export default function OrdersPanel({ refreshKey, onTradeComplete }: OrdersPanelProps) {
  const [orders, setOrders] = useState<Order[]>([])

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders')
      const json = await res.json()
      if (json.data) setOrders(json.data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 5000)
    return () => clearInterval(interval)
  }, [refreshKey, fetchOrders])

  const handleCancel = async (id: number) => {
    try {
      await fetch(`/api/orders/${id}`, { method: 'DELETE' })
      onTradeComplete()
      fetchOrders()
    } catch {
      // ignore
    }
  }

  const getLabel = (sym: string) => getInstrument(sym)?.base ?? sym

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1">
        <span className="rounded bg-[var(--bg-hover)] px-3 py-1 text-xs font-medium text-[var(--blue)]">
          Open Orders ({orders.length})
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
            No open orders
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Symbol</th>
                <th className="px-3 py-2 text-center font-medium">Type</th>
                <th className="px-3 py-2 text-center font-medium">Side</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-center font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                  <td className="px-3 py-2 font-medium">{getLabel(order.symbol)}</td>
                  <td className="px-3 py-2 text-center uppercase text-[var(--text-secondary)]">{order.type}</td>
                  <td className={`px-3 py-2 text-center ${order.side === 'buy' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                    {order.side.toUpperCase()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{(order.price * 96.5).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{order.quantity}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => handleCancel(order.id)}
                      className="rounded bg-[var(--red)]/20 px-2 py-1 text-[var(--red)] hover:bg-[var(--red)]/30"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

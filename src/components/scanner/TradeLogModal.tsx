'use client'

import { useState } from 'react'
import type { PickData } from './PickCard'

export interface TradeLogData {
  id?: number
  symbol: string
  method_id: string
  entry_price: number
  exit_price?: number
  return_pct?: number
  status: string
  notes: string
  tags: string[]
}

export default function TradeLogModal({
  pick,
  trade,
  onClose,
  onSaved,
}: {
  pick?: PickData | null
  trade?: TradeLogData | null
  onClose: () => void
  onSaved: () => void
}) {
  const [stock, setStock] = useState(trade?.symbol || pick?.symbol?.replace('.NS', '') || '')
  const [method, setMethod] = useState(trade?.method_id || pick?.methods_triggered?.[0] || 'M1')
  const [entryPrice, setEntryPrice] = useState<string>(String(trade?.entry_price || pick?.entry_high || ''))
  const [exitPrice, setExitPrice] = useState<string>(String(trade?.exit_price || ''))
  const [notes, setNotes] = useState(trade?.notes || '')
  const [tags, setTags] = useState<string[]>(trade?.tags || [])
  const [saving, setSaving] = useState(false)

  const isEdit = !!trade?.id

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const payload = {
      stock,
      method,
      entry_price: parseFloat(entryPrice),
      exit_price: exitPrice ? parseFloat(exitPrice) : undefined,
      notes,
      tags,
      score: pick?.score,
    }

    try {
      if (isEdit) {
        await fetch(`/scanner/api/trades/${trade!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exit_price: exitPrice ? parseFloat(exitPrice) : null,
            status: exitPrice ? 'closed' : 'open',
            notes,
            tags,
          }),
        })
      } else {
        await fetch('/scanner/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      onSaved()
      onClose()
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const FAIL_TAGS = ['FAKEOUT', 'NEWS_DRIVEN', 'OVEREXTENDED', 'STOPPED_OUT', 'TARGET_HIT']

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            {isEdit ? 'Update Trade' : 'Log Trade'}
          </h3>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] uppercase text-[var(--text-secondary)]">Stock</label>
              <input
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full rounded bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-primary)]"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase text-[var(--text-secondary)]">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-primary)]"
              >
                {['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] uppercase text-[var(--text-secondary)]">Entry Price ₹</label>
              <input
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                className="w-full rounded bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-primary)]"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase text-[var(--text-secondary)]">Exit Price ₹</label>
              <input
                type="number"
                step="0.01"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                className="w-full rounded bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-primary)]"
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase text-[var(--text-secondary)]">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-primary)]"
              rows={2}
              placeholder="Strategy notes, catalyst, etc."
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase text-[var(--text-secondary)]">Failure / Outcome Tags</label>
            <div className="flex flex-wrap gap-1">
              {FAIL_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded px-2 py-1 text-[10px] font-medium ${
                    tags.includes(tag)
                      ? 'bg-[var(--blue)]/30 text-[var(--blue)]'
                      : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                  }`}
                >
                  {tag.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-[var(--blue)] py-2.5 text-xs font-medium text-white hover:bg-[var(--blue)]/80 disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Update Trade' : 'Log Trade'}
          </button>
        </form>
      </div>
    </div>
  )
}

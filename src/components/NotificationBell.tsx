'use client'

import { useState, useEffect, useCallback } from 'react'

interface Notification {
  id: number
  type: string
  symbol: string | null
  title: string
  message: string
  severity: string
  isRead: boolean
  createdAt: string
}

export default function NotificationBell({ refreshKey, onNavigate }: { refreshKey: number; onNavigate?: (tab: string, symbol?: string) => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Notification | null>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=20')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 15000)
    return () => clearInterval(interval)
  }, [fetchNotifications, refreshKey])

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      })
      setUnreadCount(0)
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    } catch {
      // ignore
    }
  }

  const handleNotificationClick = async (n: Notification) => {
    // Mark as read
    if (!n.isRead) {
      try {
        await fetch('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read', id: n.id }),
        })
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x))
        setUnreadCount(c => Math.max(0, c - 1))
      } catch {
        // ignore
      }
    }
    // Show detail popup
    setSelected(n)
    setOpen(false)
  }

  const handleGoToTab = () => {
    if (!selected || !onNavigate) return
    const tabMap: Record<string, string> = {
      trade_open: 'holdings',
      trade_close: 'holdings',
      risk_event: 'strategy',
      system: 'health',
      report: 'reports',
    }
    const tab = tabMap[selected.type] || 'home'
    onNavigate(tab, selected.symbol || undefined)
    setSelected(null)
  }

  const severityColors: Record<string, string> = {
    info: 'text-blue-400',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    danger: 'text-red-400',
  }
  const severityBg: Record<string, string> = {
    info: 'border-blue-600/40 bg-blue-950/40',
    success: 'border-green-600/40 bg-green-950/40',
    warning: 'border-yellow-600/40 bg-yellow-950/40',
    danger: 'border-red-600/40 bg-red-950/40',
  }
  const typeIcons: Record<string, string> = {
    trade_open: '🟢',
    trade_close: '🔴',
    risk_event: '⚠️',
    system: '⚙️',
    report: '📄',
  }
  const typeLabels: Record<string, string> = {
    trade_open: 'Position Opened',
    trade_close: 'Position Closed',
    risk_event: 'Risk Event',
    system: 'System',
    report: 'Daily Report',
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="relative flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <span className="text-sm">🔔</span>
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
              <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Notifications {unreadCount > 0 && `(${unreadCount} new)`}
                </span>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-[10px] text-[var(--blue)] hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--text-secondary)]">
                  No notifications yet
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-color)]/50">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`flex cursor-pointer gap-2 p-2 transition-colors hover:bg-[var(--bg-hover)] ${!n.isRead ? 'bg-[var(--blue)]/5' : ''}`}
                    >
                      <span className="text-sm">{typeIcons[n.type] || '📊'}</span>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`truncate text-xs font-medium ${severityColors[n.severity] || 'text-[var(--text-primary)]'}`}>
                            {n.title}
                          </span>
                          {!n.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--blue)]" />}
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">{n.message}</p>
                        <span className="text-[9px] text-[var(--text-secondary)]">
                          {new Date(n.createdAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Detail popup */}
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div
            className={`w-full max-w-md rounded-xl border p-5 shadow-2xl ${severityBg[selected.severity] || 'border-slate-600 bg-slate-900'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3">
              <span className="text-3xl">{typeIcons[selected.type] || '📊'}</span>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                  {typeLabels[selected.type] || selected.type}
                </div>
                <h3 className={`text-lg font-bold ${severityColors[selected.severity] || 'text-white'}`}>
                  {selected.title}
                </h3>
              </div>
            </div>

            {/* Symbol badge */}
            {selected.symbol && (
              <div className="mt-3">
                <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white">
                  📈 {selected.symbol}
                </span>
              </div>
            )}

            {/* Message */}
            <div className="mt-4 rounded-lg bg-slate-900/60 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Details</div>
              <p className="mt-1 text-sm text-white">{selected.message}</p>
            </div>

            {/* Timestamp */}
            <div className="mt-3 text-xs text-[var(--text-secondary)]">
              🕐 {new Date(selected.createdAt).toLocaleString('en-IN', {
                weekday: 'short', day: 'numeric', month: 'short',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </div>

            {/* Actions */}
            <div className="mt-5 flex gap-2">
              {selected.symbol && (
                <button
                  onClick={handleGoToTab}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  View {selected.symbol} →
                </button>
              )}
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

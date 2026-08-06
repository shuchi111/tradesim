'use client'

import { useState, useEffect, useCallback } from 'react'

interface IntelligenceData {
  exitReasonBreakdown: Record<string, { count: number; totalPnl: number; avgPnlPct: number }>
  entryReasonBreakdown: Record<string, { count: number; totalPnl: number; winRate: number }>
  mfeMae: Array<{ tradeId: number; symbol: string; mfe: number; mae: number; pnl: number; pnlPct: number; exitReason: string }>
  recentEvents: Array<{ id: number; symbol: string; eventType: string; triggerReason: string; pnlPct: number; peakGainPct: number; timestamp: string }>
  totalTrades: number
}

interface TrailingStopData {
  trailingStops: Array<{
    symbol: string
    entryPrice: number
    currentPrice: number
    peakPrice: number
    pnlPct: number
    peakGainPct: number
    isTrailingActive: boolean
    trailingStopLevel: number | null
    distanceToStop: number | null
    protectedGain: number
    quantity: number
    pnl: number
  }>
  count: number
  activeCount: number
}

interface TimelineData {
  trade: {
    id: number
    symbol: string
    entryPrice: number
    exitPrice: number
    pnl: number
    pnlPct: number
    openedAt: string
    closedAt: string
    exitReason: string
    entryReason: string
    maxFavorable: number | null
    maxAdverse: number | null
    holdDuration: number | null
  }
  timeline: Array<Record<string, unknown>>
  eventCount: number
}

const REASON_LABELS: Record<string, string> = {
  trailing_stop: '🛡️ Trailing Stop',
  stop_loss: '🛑 Stop Loss',
  take_profit: '🎯 Take Profit',
  signal_sell: '📉 Signal Sell',
  manual: '✋ Manual',
}

const EVENT_ICONS: Record<string, string> = {
  entry: '🟢',
  peak_update: '📈',
  trailing_stop: '🛡️',
  stop_loss: '🛑',
  take_profit: '🎯',
  signal_sell: '📉',
  trailing_trigger: '🛡️',
  stop_loss_trigger: '🛑',
  take_profit_trigger: '🎯',
  signal_exit: '📉',
}

export default function TradeIntelligenceTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const [intData, setIntData] = useState<IntelligenceData | null>(null)
  const [tsData, setTsData] = useState<TrailingStopData | null>(null)
  const [timeline, setTimeline] = useState<TimelineData | null>(null)
  const [selectedTrade, setSelectedTrade] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [intRes, tsRes] = await Promise.all([
        fetch('/api/trades/intelligence'),
        fetch('/api/trailing-stops'),
      ])
      if (intRes.ok) setIntData(await intRes.json())
      if (tsRes.ok) setTsData(await tsRes.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData, refreshKey])

  // Fetch timeline when a trade is selected
  useEffect(() => {
    if (selectedTrade === null) {
      setTimeline(null)
      return
    }
    fetch(`/api/trades/timeline/${selectedTrade}`)
      .then(r => r.ok ? r.json() : null)
      .then(setTimeline)
      .catch(() => {})
  }, [selectedTrade])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[var(--text-secondary)]">Loading trade intelligence...</div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">🔍 Trade Intelligence</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Track why trades opened, why they closed, and how trailing stops protected profits
            </p>
          </div>
        </div>

        {/* Active Trailing Stops */}
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            🛡️ Active Trailing Stops
            {tsData && (
              <span className="ml-2 rounded bg-[var(--blue)]/20 px-2 py-0.5 text-xs text-[var(--blue)]">
                {tsData.activeCount} active
              </span>
            )}
          </h3>
          {!tsData || tsData.count === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--text-secondary)]">No open positions</p>
          ) : (
            <div className="space-y-2">
              {tsData.trailingStops.map((ts) => (
                <div key={ts.symbol} className="rounded-lg bg-[var(--bg-tertiary)] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)]">{ts.symbol}</span>
                      {ts.isTrailingActive && (
                        <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                          TRAILING ACTIVE
                        </span>
                      )}
                    </div>
                    <span className={`text-sm font-bold ${ts.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                      {ts.pnl >= 0 ? '+' : ''}₹{ts.pnl.toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-[var(--text-secondary)]">Entry</div>
                      <div className="text-[var(--text-primary)]">₹{ts.entryPrice.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-secondary)]">Current</div>
                      <div className="text-[var(--text-primary)]">₹{ts.currentPrice.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-secondary)]">Peak</div>
                      <div className="text-green-400">₹{ts.peakPrice.toFixed(2)} (+{ts.peakGainPct.toFixed(1)}%)</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-secondary)]">Stop Level</div>
                      {ts.trailingStopLevel ? (
                        <div className="text-yellow-400">
                          ₹{ts.trailingStopLevel.toFixed(2)}
                          {ts.distanceToStop !== null && (
                            <span className="ml-1 text-[10px]">({ts.distanceToStop.toFixed(1)}% away)</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--text-secondary)]">Not active</span>
                      )}
                    </div>
                  </div>
                  {/* Visual trailing stop bar */}
                  <div className="mt-2">
                    <div className="relative h-2 rounded-full bg-[var(--bg-hover)]">
                      <div
                        className="absolute h-full rounded-full bg-[var(--blue)]"
                        style={{ width: `${Math.max(0, Math.min(100, ((ts.currentPrice - ts.entryPrice) / Math.max(ts.peakPrice - ts.entryPrice, 0.001)) * 100))}%` }}
                      />
                      <div
                        className="absolute top-0 h-full w-0.5 bg-green-400"
                        style={{ left: `${Math.max(0, Math.min(100, ((ts.peakPrice - ts.entryPrice) / Math.max(ts.peakPrice - ts.entryPrice, 0.001)) * 100))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-[var(--text-secondary)]">
                      <span>Entry</span>
                      <span className="text-green-400">Peak +{ts.peakGainPct.toFixed(1)}%</span>
                      <span>Protected: +{ts.protectedGain.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Exit Reason Breakdown */}
        {intData && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">📊 Exit Reason Analysis</h3>
            <div className="space-y-2">
              {Object.entries(intData.exitReasonBreakdown)
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([reason, data]) => (
                  <div key={reason} className="flex items-center gap-3 rounded-lg bg-[var(--bg-tertiary)] p-2">
                    <div className="w-32 text-xs font-medium text-[var(--text-primary)]">
                      {REASON_LABELS[reason] || reason}
                    </div>
                    <div className="flex-1">
                      <div className="relative h-6 rounded bg-[var(--bg-hover)]">
                        <div
                          className={`absolute h-full rounded ${data.totalPnl >= 0 ? 'bg-green-500/40' : 'bg-red-500/40'}`}
                          style={{ width: `${Math.min(100, (data.count / intData.totalTrades) * 100)}%` }}
                        />
                        <div className="absolute inset-0 flex items-center px-2 text-xs text-[var(--text-primary)]">
                          {data.count} trades
                        </div>
                      </div>
                    </div>
                    <div className="w-24 text-right text-xs">
                      <span className={data.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {data.totalPnl >= 0 ? '+' : ''}₹{data.totalPnl.toFixed(0)}
                      </span>
                    </div>
                    <div className="w-16 text-right text-xs text-[var(--text-secondary)]">
                      avg {data.avgPnlPct.toFixed(1)}%
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* MFE/MAE Scatter */}
        {intData && intData.mfeMae.length > 0 && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">📊 MFE/MAE Analysis</h3>
            <p className="mb-2 text-xs text-[var(--text-secondary)]">
              Maximum Favorable Excursion (peak profit) vs Maximum Adverse Excursion (worst loss)
            </p>
            <div className="space-y-1">
              {intData.mfeMae.slice(0, 15).map((m) => (
                <div key={m.tradeId} className="flex items-center gap-2 text-xs">
                  <span
                    className="cursor-pointer font-medium text-[var(--blue)] hover:underline"
                    onClick={() => setSelectedTrade(m.tradeId)}
                  >
                    {m.symbol}
                  </span>
                  <div className="flex flex-1 items-center gap-1">
                    <span className="w-12 text-right text-green-400">+{m.mfe.toFixed(1)}%</span>
                    <div className="relative h-4 flex-1 rounded bg-[var(--bg-hover)]">
                      <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--border-color)]" />
                      <div
                        className="absolute top-0 h-full bg-green-500/30"
                        style={{ left: '50%', width: `${Math.min(50, m.mfe * 2)}%` }}
                      />
                      <div
                        className="absolute top-0 h-full bg-red-500/30"
                        style={{ right: '50%', width: `${Math.min(50, Math.abs(m.mae) * 2)}%` }}
                      />
                    </div>
                    <span className="w-12 text-red-400">{m.mae.toFixed(1)}%</span>
                  </div>
                  <span className={`w-16 text-right ${m.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {m.pnl >= 0 ? '+' : ''}₹{m.pnl.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Risk Events */}
        {intData && intData.recentEvents.length > 0 && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">⚡ Recent Risk Events</h3>
            <div className="space-y-1">
              {intData.recentEvents.slice(0, 10).map((evt) => (
                <div key={evt.id} className="flex items-center gap-2 rounded bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
                  <span>{EVENT_ICONS[evt.eventType] || '📊'}</span>
                  <span className="font-medium text-[var(--text-primary)]">{evt.symbol}</span>
                  <span className="flex-1 text-[var(--text-secondary)]">{evt.triggerReason}</span>
                  <span className={evt.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {evt.pnlPct >= 0 ? '+' : ''}{evt.pnlPct.toFixed(1)}%
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {new Date(evt.timestamp).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trade Timeline Viewer */}
        {timeline && (
          <div className="rounded-lg border border-[var(--blue)]/30 bg-[var(--bg-secondary)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                📋 Trade Timeline: {timeline.trade.symbol}
              </h3>
              <button
                onClick={() => setSelectedTrade(null)}
                className="rounded bg-[var(--bg-hover)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                ✕ Close
              </button>
            </div>
            <div className="relative space-y-3 border-l-2 border-[var(--border-color)] pl-4">
              {timeline.timeline.map((evt: any, i: number) => (
                <div key={i} className="relative">
                  <div className="absolute -left-[21px] flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-secondary)]">
                    <span className="text-[10px]">{EVENT_ICONS[evt.type] || '•'}</span>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text-primary)]">{evt.title}</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        {new Date(evt.timestamp).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">{evt.description}</p>
                    {evt.pnlPct !== undefined && (
                      <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${evt.pnlPct >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {evt.pnlPct >= 0 ? '+' : ''}{evt.pnlPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

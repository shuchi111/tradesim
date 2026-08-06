'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCurrency } from '@/lib/currency'
import { toReportDateKey } from '@/lib/report-date-utils'

interface ReportSummary {
  id: number
  reportDate: string
  startingEquity: number
  endingEquity: number
  dailyPnl: number
  dailyPnlPct: number
  tradesCount: number
  winRate: number
  summary: string
  metrics: Record<string, number>
}

interface FullReport {
  id: number
  reportDate: string
  startingEquity: number
  endingEquity: number
  dailyPnl: number
  dailyPnlPct: number
  tradesCount: number
  winRate: number
  metrics: Record<string, number>
  tradesData: Record<string, unknown>[]
  riskEvents: Record<string, unknown>[]
  summary: string
  topWinners: Record<string, unknown>[] | null
  topLosers: Record<string, unknown>[] | null
  openPositions: Record<string, unknown>[] | null
}

export default function ReportsTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const { fmt } = useCurrency()
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [selectedReport, setSelectedReport] = useState<FullReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/reports?limit=30')
      if (res.ok) {
        const data = await res.json()
        setReports(data.reports)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports, refreshKey])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await fetch('/api/reports', { method: 'POST' })
      await fetchReports()
    } catch {
      // ignore
    } finally {
      setGenerating(false)
    }
  }

  const handleViewReport = async (date: string) => {
    const dateStr = toReportDateKey(date)
    setViewError(null)
    try {
      const res = await fetch(`/api/reports/${dateStr}`)
      if (res.ok) {
        setSelectedReport(await res.json())
      } else {
        const data = await res.json().catch(() => ({}))
        setViewError(data.error || `Could not load report for ${dateStr}`)
      }
    } catch {
      setViewError('Failed to load report')
    }
  }

  const handleDownload = (date: string, format: 'csv' | 'pdf') => {
    const dateStr = toReportDateKey(date)
    window.open(`/api/reports/${dateStr}/download?format=${format}`, '_blank')
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[var(--text-secondary)]">Loading reports...</div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">📄 Daily Reports</h2>
            <p className="text-xs text-[var(--text-secondary)]">Automated daily performance reports with download</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-lg bg-[var(--blue)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--blue)]/80 disabled:opacity-50"
          >
            {generating ? 'Generating...' : '📊 Generate Now'}
          </button>
        </div>

        {viewError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
            {viewError}
          </div>
        )}

        {selectedReport ? (
          /* Full Report View */
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Report: {new Date(selectedReport.reportDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDownload(selectedReport.reportDate, 'csv')}
                  className="rounded bg-[var(--bg-hover)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  ⬇ CSV
                </button>
                <button
                  onClick={() => handleDownload(selectedReport.reportDate, 'pdf')}
                  className="rounded bg-[var(--bg-hover)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  🖨 PDF
                </button>
                <button
                  onClick={() => setSelectedReport(null)}
                  className="rounded bg-[var(--bg-hover)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  ✕ Back
                </button>
              </div>
            </div>

            {/* Summary */}
            <div className="mb-4 rounded-lg bg-[var(--bg-tertiary)] p-3">
              <p className="text-xs text-[var(--text-secondary)]">{selectedReport.summary}</p>
            </div>

            {/* Key Metrics Grid */}
            <div className="mb-4 grid grid-cols-4 gap-3">
              <MetricCard label="Daily P&L" value={`${selectedReport.dailyPnl >= 0 ? '+' : ''}${fmt(selectedReport.dailyPnl, { decimals: 2 })}`} positive={selectedReport.dailyPnl >= 0} />
              <MetricCard label="P&L %" value={`${selectedReport.dailyPnlPct >= 0 ? '+' : ''}${selectedReport.dailyPnlPct.toFixed(2)}%`} positive={selectedReport.dailyPnlPct >= 0} />
              <MetricCard label="Equity" value={fmt(selectedReport.endingEquity, { decimals: 0 })} />
              <MetricCard label="Win Rate" value={`${selectedReport.winRate.toFixed(0)}%`} />
              <MetricCard label="Sharpe" value={(selectedReport.metrics as any)?.sharpe?.toFixed(2) ?? '0.00'} />
              <MetricCard label="Max DD" value={`${(selectedReport.metrics as any)?.maxDrawdown?.toFixed(1) ?? '0.0'}%`} />
              <MetricCard label="Profit Factor" value={(selectedReport.metrics as any)?.profitFactor?.toFixed(2) ?? '0.00'} />
              <MetricCard label="Trades" value={String(selectedReport.tradesCount)} />
            </div>

            {/* Trade Log */}
            {selectedReport.tradesData && (selectedReport.tradesData as any[]).length > 0 && (
              <div className="mb-4">
                <h4 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Trade Log</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                        <th className="px-2 py-1 text-left">Symbol</th>
                        <th className="px-2 py-1 text-right">Entry</th>
                        <th className="px-2 py-1 text-right">Exit</th>
                        <th className="px-2 py-1 text-right">P&L</th>
                        <th className="px-2 py-1 text-right">P&L %</th>
                        <th className="px-2 py-1 text-left">Exit Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedReport.tradesData as any[]).map((t: any, i: number) => (
                        <tr key={i} className="border-b border-[var(--border-color)]/50">
                          <td className="px-2 py-1 text-[var(--text-primary)]">{t.symbol}</td>
                          <td className="px-2 py-1 text-right">₹{t.entryPrice.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right">₹{t.exitPrice.toFixed(2)}</td>
                          <td className={`px-2 py-1 text-right ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.pnl >= 0 ? '+' : ''}₹{t.pnl.toFixed(2)}</td>
                          <td className={`px-2 py-1 text-right ${t.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.pnlPct.toFixed(1)}%</td>
                          <td className="px-2 py-1 text-[var(--text-secondary)]">{t.exitReason || 'manual'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Risk Events */}
            {selectedReport.riskEvents && (selectedReport.riskEvents as any[]).length > 0 && (
              <div className="mb-4">
                <h4 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Risk Events</h4>
                <div className="space-y-1">
                  {(selectedReport.riskEvents as any[]).map((e: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 rounded bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
                      <span className="font-medium text-[var(--text-primary)]">{e.symbol}</span>
                      <span className="text-[var(--text-secondary)]">{e.eventType.replace(/_/g, ' ')}</span>
                      <span className="flex-1 text-[var(--text-secondary)]">{e.triggerReason}</span>
                      <span className={e.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}>{e.pnlPct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Report List with Calendar */
          <>
            {reports.length === 0 ? (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 text-center">
                <p className="text-sm text-[var(--text-secondary)]">No reports yet.</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Click "Generate Now" to create today&apos;s report, or wait for the automatic 6 PM IST generation.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Report History</h3>
                <div className="space-y-1">
                  {reports.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg bg-[var(--bg-tertiary)] p-3 hover:bg-[var(--bg-hover)]">
                      {/* Date with P&L color */}
                      <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-lg ${r.dailyPnl >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                        <span className="text-xs font-bold text-[var(--text-primary)]">{new Date(r.reportDate).getDate()}</span>
                        <span className="text-[9px] text-[var(--text-secondary)]">{new Date(r.reportDate).toLocaleDateString('en-IN', { month: 'short' })}</span>
                      </div>

                      {/* Details */}
                      <div className="flex-1 cursor-pointer" onClick={() => handleViewReport(r.reportDate)}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[var(--text-primary)]">
                            {new Date(r.reportDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.dailyPnl >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {r.dailyPnl >= 0 ? '+' : ''}{fmt(r.dailyPnl, { decimals: 2 })} ({r.dailyPnlPct >= 0 ? '+' : ''}{r.dailyPnlPct.toFixed(2)}%)
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-[var(--text-secondary)] line-clamp-1">{r.summary}</p>
                      </div>

                      {/* Quick stats */}
                      <div className="flex gap-4 text-xs">
                        <div className="text-center">
                          <div className="text-[var(--text-primary)]">{r.tradesCount}</div>
                          <div className="text-[9px] text-[var(--text-secondary)]">Trades</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[var(--text-primary)]">{r.winRate.toFixed(0)}%</div>
                          <div className="text-[9px] text-[var(--text-secondary)]">Win</div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleViewReport(r.reportDate)}
                          className="rounded bg-[var(--bg-hover)] px-2 py-1 text-[10px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDownload(r.reportDate, 'csv')}
                          className="rounded bg-[var(--bg-hover)] px-2 py-1 text-[10px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                        >
                          ⬇
                        </button>
                        <button
                          onClick={() => handleDownload(r.reportDate, 'pdf')}
                          className="rounded bg-[var(--bg-hover)] px-2 py-1 text-[10px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                        >
                          🖨
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MetricCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg bg-[var(--bg-tertiary)] p-3 text-center">
      <div className={`text-base font-bold ${positive === undefined ? 'text-[var(--text-primary)]' : positive ? 'text-green-400' : 'text-red-400'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}

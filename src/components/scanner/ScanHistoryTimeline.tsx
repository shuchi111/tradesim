'use client'

import { useState } from 'react'

interface ScanHistoryItem {
  id: number
  scan_date: string
  regime: string
  vix: number
  nifty_close: number
  fii_net: number
  picks: any[]
  methods_fired: Record<string, number>
}

export default function ScanHistoryTimeline({ history }: { history: ScanHistoryItem[] }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  if (history.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Scan History</h3>
        <p className="py-4 text-center text-xs text-[var(--text-secondary)]">No past scans. Run a scan to build history.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Scan History Timeline</h3>
      <div className="space-y-1">
        {history.map((scan) => {
          const isOpen = expanded === scan.id
          const topPick = scan.picks?.[0]
          const regimeColor = scan.regime === 'BULLISH' ? 'bg-green-500/20 text-green-400'
            : scan.regime === 'BEARISH' ? 'bg-red-500/20 text-red-400'
            : 'bg-yellow-500/20 text-yellow-400'

          return (
            <div key={scan.id}>
              <div
                className="flex cursor-pointer items-center gap-3 rounded-lg bg-[var(--bg-tertiary)] p-2 hover:bg-[var(--bg-hover)]"
                onClick={() => setExpanded(isOpen ? null : scan.id)}
              >
                <span className="text-xs text-[var(--text-secondary)]">
                  {new Date(scan.scan_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${regimeColor}`}>
                  {scan.regime}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">VIX {scan.vix?.toFixed(1)}</span>
                <span className="text-xs text-[var(--text-secondary)]">Nifty {scan.nifty_close?.toLocaleString('en-IN')}</span>
                <span className="flex-1 text-xs text-[var(--text-primary)]">
                  {topPick ? `🏆 ${topPick.symbol?.replace('.NS', '')} (Score: ${topPick.score})` : 'No picks'}
                </span>
                <span className="text-[var(--text-secondary)]">{isOpen ? '▼' : '▶'}</span>
              </div>

              {isOpen && (
                <div className="ml-4 mt-1 space-y-1 rounded-lg bg-[var(--bg-secondary)] p-2">
                  {scan.picks?.map((pick, i) => (
                    <div key={i} className="flex items-center gap-2 rounded bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
                      <span className="font-bold text-[var(--text-primary)]">#{i + 1} {pick.symbol?.replace('.NS', '')}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${pick.score >= 7 ? 'bg-green-500/20 text-green-400' : pick.score >= 5 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                        Score: {pick.score}
                      </span>
                      <span className="text-[var(--text-secondary)]">Entry ₹{pick.entry_low}-{pick.entry_high}</span>
                      <span className="text-red-400">SL ₹{pick.stop_loss}</span>
                      <span className="text-green-400">T1 ₹{pick.target_1}</span>
                      <span className="text-[var(--text-secondary)]">{pick.methods_triggered?.join(', ')}</span>
                    </div>
                  ))}
                  {scan.methods_fired && Object.keys(scan.methods_fired).length > 0 && (
                    <div className="px-3 py-1 text-[10px] text-[var(--text-secondary)]">
                      Methods fired: {Object.entries(scan.methods_fired).map(([m, c]) => `${m}(${c})`).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

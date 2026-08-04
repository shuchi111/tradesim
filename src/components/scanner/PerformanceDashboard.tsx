'use client'

interface MethodPerf {
  method_id: string
  total_trades: number
  wins: number
  win_rate: number
  avg_return: number
  composite_score: number
}

const METHOD_NAMES: Record<string, string> = {
  M1: 'Breakout+Vol',
  M2: 'ST+MACD',
  M3: 'RSI Rev',
  M4: 'EMA Cross',
  M5: 'Sector Mom',
  M6: 'Engulfing',
  M7: 'AI Score',
}

export default function PerformanceDashboard({
  performance,
  trades,
}: {
  performance: MethodPerf[]
  trades: any[]
}) {
  const totalTrades = trades.length
  const closedTrades = trades.filter(t => t.status === 'closed')
  const openTrades = trades.filter(t => t.status === 'open')
  const wins = closedTrades.filter(t => (t.return_pct || 0) > 0)
  const overallWinRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0
  const avgReturn = closedTrades.length > 0
    ? closedTrades.reduce((s, t) => s + (t.return_pct || 0), 0) / closedTrades.length
    : 0

  return (
    <div className="space-y-3">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Trades" value={String(totalTrades)} />
        <StatCard label="Open" value={String(openTrades.length)} color="text-blue-400" />
        <StatCard label="Win Rate" value={`${overallWinRate.toFixed(1)}%`} color={overallWinRate >= 50 ? 'text-green-400' : 'text-red-400'} />
        <StatCard label="Avg Return" value={`${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`} color={avgReturn >= 0 ? 'text-green-400' : 'text-red-400'} />
      </div>

      {/* Per-method bar chart */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Method Performance</h3>
        <div className="space-y-2">
          {performance.map((p) => {
            const maxScore = Math.max(...performance.map(x => Math.abs(x.composite_score)), 60)
            const barWidth = (Math.abs(p.composite_score) / maxScore) * 100
            const barColor = p.composite_score >= 40 ? 'bg-green-500' : p.composite_score >= 20 ? 'bg-yellow-500' : p.composite_score >= 0 ? 'bg-orange-500' : 'bg-red-500'
            return (
              <div key={p.method_id} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-[var(--text-secondary)]">{METHOD_NAMES[p.method_id] || p.method_id}</span>
                <div className="flex-1">
                  <div className="relative h-6 rounded bg-[var(--bg-hover)]">
                    <div
                      className={`absolute h-full rounded ${barColor}`}
                      style={{ width: `${Math.max(2, barWidth)}%`, opacity: 0.6 }}
                    />
                    <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px]">
                      <span className="text-[var(--text-primary)]">
                        {p.total_trades > 0 ? `${p.wins}/${p.total_trades} wins` : 'No trades'}
                      </span>
                      <span className={`font-bold ${p.composite_score >= 40 ? 'text-green-400' : p.composite_score >= 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {p.composite_score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
                <span className="w-16 shrink-0 text-right text-[var(--text-secondary)]">
                  {p.win_rate.toFixed(0)}% WR
                </span>
                <span className="w-16 shrink-0 text-right text-[var(--text-secondary)]">
                  {p.avg_return >= 0 ? '+' : ''}{p.avg_return.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Trade list */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Trade Log ({trades.length})</h3>
        {trades.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--text-secondary)]">No trades logged yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                  <th className="px-2 py-1 text-left">Stock</th>
                  <th className="px-2 py-1 text-left">Method</th>
                  <th className="px-2 py-1 text-right">Entry</th>
                  <th className="px-2 py-1 text-right">Exit</th>
                  <th className="px-2 py-1 text-right">Return</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-left">Tags</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border-color)]/50">
                    <td className="px-2 py-1.5 font-medium text-[var(--text-primary)]">{t.symbol}</td>
                    <td className="px-2 py-1.5 text-[var(--blue)]">{t.method_id}</td>
                    <td className="px-2 py-1.5 text-right">₹{t.entry_price?.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right">{t.exit_price ? `₹${t.exit_price.toFixed(2)}` : '-'}</td>
                    <td className={`px-2 py-1.5 text-right ${(t.return_pct || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.return_pct != null ? `${t.return_pct >= 0 ? '+' : ''}${t.return_pct.toFixed(2)}%` : '-'}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                        t.status === 'closed' ? 'bg-gray-500/20 text-gray-400' : 'bg-blue-500/20 text-blue-400'
                      }`}>{t.status}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {t.tags && JSON.parse(t.tags_json || t.tags || '[]').length > 0 && (
                        <div className="flex gap-1">
                          {(typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : t.tags).map((tag: string, i: number) => (
                            <span key={i} className="rounded bg-red-500/10 px-1 text-[9px] text-red-400">{tag}</span>
                          ))}
                        </div>
                      )}
                    </td>
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

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-center">
      <div className={`text-xl font-bold ${color || 'text-[var(--text-primary)]'}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}

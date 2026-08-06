'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import MarketContextStrip from '@/components/scanner/MarketContextStrip'
import MethodScanSummary from '@/components/scanner/MethodScanSummary'
import PickCard, { type PickData } from '@/components/scanner/PickCard'
import TradeLogModal from '@/components/scanner/TradeLogModal'
import PerformanceDashboard from '@/components/scanner/PerformanceDashboard'
import ScanHistoryTimeline from '@/components/scanner/ScanHistoryTimeline'

const AgentPanel = dynamic(() => import('@/components/scanner/AgentPanel'), { ssr: false })

type ScannerView = 'scan' | 'agents' | 'performance' | 'history'

export default function ScannerTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const [view, setView] = useState<ScannerView>('scan')
  const [picks, setPicks] = useState<PickData[]>([])
  const [methodsFired, setMethodsFired] = useState<Record<string, number>>({})
  const [scanning, setScanning] = useState(false)
  const [scanMeta, setScanMeta] = useState<{ total_scanned: number; total_candidates: number; scan_date: string } | null>(null)
  const [showLogModal, setShowLogModal] = useState(false)
  const [activePick, setActivePick] = useState<PickData | null>(null)
  const [performance, setPerformance] = useState<any[]>([])
  const [trades, setTrades] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])

  // Fetch latest scan on mount / after cron refreshKey
  useEffect(() => {
    fetchLatestScan()
    fetchPerformance()
    fetchTrades()
    fetchHistory()
  }, [refreshKey])

  const fetchLatestScan = async () => {
    // Prefer Turso-synced scan (cron), fall back to live scanner
    try {
      const res = await fetch('/api/scanner/latest')
      if (res.ok) {
        const data = await res.json()
        if (data.picks) {
          setPicks(data.picks)
          setMethodsFired(data.methods_fired || {})
          setScanMeta({
            total_scanned: data.total_scanned || 0,
            total_candidates: data.total_candidates || 0,
            scan_date: data.scan_date,
          })
          return
        }
      }
    } catch { /* fall through */ }

    try {
      const res = await fetch('/scanner/api/scan/latest')
      if (res.ok) {
        const data = await res.json()
        if (data.picks) {
          setPicks(data.picks)
          setMethodsFired(data.methods_fired || {})
          setScanMeta({
            total_scanned: data.total_scanned || 0,
            total_candidates: data.total_candidates || 0,
            scan_date: data.scan_date,
          })
        }
      }
    } catch {}
  }

  const fetchPerformance = async () => {
    try {
      const res = await fetch('/scanner/api/performance')
      if (res.ok) {
        const data = await res.json()
        setPerformance(data.performance || [])
      }
    } catch {}
  }

  const fetchTrades = async () => {
    try {
      const res = await fetch('/scanner/api/trades')
      if (res.ok) {
        const data = await res.json()
        setTrades(data.trades || [])
      }
    } catch {}
  }

  const fetchHistory = async () => {
    // Prefer Turso history, fall back to scanner
    try {
      const res = await fetch('/api/scanner/history?limit=30')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.history) && data.history.length > 0) {
          setHistory(data.history)
          return
        }
      }
    } catch { /* fall through */ }

    try {
      const res = await fetch('/scanner/api/scan/history')
      if (res.ok) {
        const data = await res.json()
        setHistory(data.history || [])
      }
    } catch {}
  }

  const handleRunScan = async () => {
    setScanning(true)
    try {
      const res = await fetch('/scanner/api/scan/run')
      if (res.ok) {
        const data = await res.json()
        // Keep live scan results — do NOT bump refreshKey (that re-fetches Turso and can overwrite)
        setPicks(data.picks || [])
        setMethodsFired(data.methods_fired || {})
        setScanMeta({
          total_scanned: data.total_scanned,
          total_candidates: data.total_candidates,
          scan_date: data.scan_date,
        })
        fetchPerformance()
        fetchTrades()
        fetchHistory()
      }
    } catch {
      // ignore
    } finally {
      setScanning(false)
    }
  }

  const handleLogTrade = (pick: PickData) => {
    setActivePick(pick)
    setShowLogModal(true)
  }

  const handleTradeSaved = () => {
    fetchPerformance()
    fetchTrades()
    fetchHistory()
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">🔬 Tauric Research Scanner</h2>
            <p className="text-xs text-[var(--text-secondary)]">7-method swing trade scanner with AI composite scoring</p>
          </div>
          <div className="flex gap-2">
            {(['scan', 'agents', 'performance', 'history'] as ScannerView[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  view === v
                    ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {v === 'agents' ? '🏛️ 10 Agents' : v}
              </button>
            ))}
          </div>
        </div>

        {/* Market context strip */}
        <MarketContextStrip refreshKey={refreshKey} />

        {view === 'scan' && (
          <>
            {/* Scan controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleRunScan}
                disabled={scanning}
                className="rounded-lg bg-[var(--blue)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--blue)]/80 disabled:opacity-50"
              >
                {scanning ? '⏳ Scanning...' : '🚀 Run Scan'}
              </button>
              {scanMeta && (
                <span className="text-xs text-[var(--text-secondary)]">
                  Last scan: {scanMeta.scan_date} • Scanned {scanMeta.total_scanned} stocks • {scanMeta.total_candidates} candidates
                </span>
              )}
            </div>

            {/* Method summary */}
            <MethodScanSummary methodsFired={methodsFired} />

            {/* Picks */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                🏆 Top Picks ({picks.length})
              </h3>
              {scanning ? (
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 text-center">
                  <p className="text-sm text-[var(--text-secondary)]">Scanning 60 NSE stocks through 7 methods...</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">This fetches live market data + AI scoring — may take 1-2 minutes</p>
                </div>
              ) : picks.length === 0 ? (
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-8 text-center">
                  <p className="text-sm text-[var(--text-secondary)]">No picks yet.</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Click &ldquo;Run Scan&rdquo; to find swing trade opportunities.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {picks.map((pick, i) => (
                    <div key={i}>
                      <div className="mb-1 text-xs font-medium text-[var(--text-secondary)]">#{i + 1}</div>
                      <PickCard pick={pick} onLogTrade={handleLogTrade} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {view === 'performance' && (
          <PerformanceDashboard performance={performance} trades={trades} />
        )}

        {view === 'agents' && (
          <AgentPanel />
        )}

        {view === 'history' && (
          <ScanHistoryTimeline history={history} />
        )}
      </div>

      {/* Trade log modal */}
      {showLogModal && (
        <TradeLogModal
          pick={activePick}
          onClose={() => setShowLogModal(false)}
          onSaved={handleTradeSaved}
        />
      )}
    </div>
  )
}

import { NextResponse } from 'next/server'
import { getLatestScannerScan } from '@/lib/ui-cache'

/**
 * GET /api/scanner/latest — latest Tauric scan from Turso (cron-synced).
 */
export async function GET() {
  try {
    const row = await getLatestScannerScan()
    if (!row) {
      return NextResponse.json({ error: 'No scan results yet' }, { status: 404 })
    }

    const picks = row.picks as unknown
    const methodStats = row.methodStats as Record<string, number> | null
    const raw = row.rawResult as Record<string, unknown> | null

    return NextResponse.json({
      id: row.id,
      scan_date: row.scanDateKey || row.scanDate.toISOString().slice(0, 10),
      regime: row.regime,
      vix: row.vix,
      picks: Array.isArray(picks) ? picks : [],
      methods_fired: methodStats || {},
      total_scanned: raw?.total_scanned ?? (Array.isArray(picks) ? picks.length : 0),
      total_candidates: raw?.total_candidates ?? (Array.isArray(picks) ? picks.length : 0),
      source: 'turso',
      created_at: row.createdAt.toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

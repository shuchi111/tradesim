import { NextRequest, NextResponse } from 'next/server'
import { listScannerScans } from '@/lib/ui-cache'

/**
 * GET /api/scanner/history?limit=30 — scan history from Turso.
 */
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(100, Number(req.nextUrl.searchParams.get('limit') || '30'))
    const rows = await listScannerScans(limit)
    const history = rows.map((row) => {
      const picks = row.picks as unknown
      const methodStats = row.methodStats as Record<string, number> | null
      return {
        id: row.id,
        scan_date: row.scanDateKey || row.scanDate.toISOString().slice(0, 10),
        regime: row.regime,
        vix: row.vix,
        picks: Array.isArray(picks) ? picks : [],
        methods_fired: methodStats || {},
        created_at: row.createdAt.toISOString(),
      }
    })
    return NextResponse.json({ history })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * CI — sync latest Tauric scan from scanner/tauric.db → Turso ScannerScan
 * + notify UI so Tauric tab can auto-load.
 */
import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { Prisma } from '@prisma/client'
import { saveScannerScan } from '../../src/lib/ui-cache'
import { createNotification } from '../../src/lib/trading'

const DB_PATH =
  process.env.TAURIC_DB_PATH ||
  path.join(process.cwd(), 'scanner', 'tauric.db')

type ScanRow = {
  scan_date: string
  regime: string | null
  vix: number | null
  nifty_close: number | null
  fii_net: number | null
  picks_json: string
  methods_fired_json: string
}

async function main() {
  console.log(`[sync-scan] Reading ${DB_PATH}`)
  const db = new Database(DB_PATH, { readonly: true })

  const row = db
    .prepare(
      `SELECT scan_date, regime, vix, nifty_close, fii_net, picks_json, methods_fired_json
       FROM scan_results
       ORDER BY scan_date DESC
       LIMIT 1`
    )
    .get() as ScanRow | undefined

  db.close()

  if (!row) {
    throw new Error('No scan_results rows found in scanner/tauric.db to sync')
  }

  let picks: Prisma.InputJsonValue = []
  let methods: Prisma.InputJsonValue = {}
  try {
    picks = JSON.parse(row.picks_json || '[]') as Prisma.InputJsonValue
  } catch {
    picks = []
  }
  try {
    methods = JSON.parse(row.methods_fired_json || '{}') as Prisma.InputJsonValue
  } catch {
    methods = {}
  }

  const pickCount = Array.isArray(picks) ? picks.length : 0

  await saveScannerScan({
    scanDate: new Date(row.scan_date),
    scanDateKey: row.scan_date,
    regime: row.regime,
    vix: row.vix,
    picks,
    methodStats: methods,
    rawResult: {
      nifty_close: row.nifty_close,
      fii_net: row.fii_net,
      total_candidates: pickCount,
      total_scanned: pickCount,
    },
  })

  await createNotification(
    'scan_ready',
    'Tauric Daily Scan Ready',
    `Scan ${row.scan_date}: ${pickCount} pick(s), regime=${row.regime ?? 'n/a'}, VIX=${row.vix ?? 'n/a'}. Open Tauric tab to view.`,
    'success'
  )

  console.log(`[sync-scan] Done — ${pickCount} picks synced for ${row.scan_date}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[sync-scan] Failed:', err)
    process.exit(1)
  })

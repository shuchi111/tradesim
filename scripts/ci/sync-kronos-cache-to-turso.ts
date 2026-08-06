/**
 * CI — sync Kronos forecasts from scanner/tauric.db → Turso ForecastCache
 * + notify UI so Forecast / AI Score tabs can auto-load.
 */
import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import { Prisma } from '@prisma/client'
import { saveForecastCache } from '../../src/lib/ui-cache'
import { createNotification } from '../../src/lib/trading'

const DB_PATH =
  process.env.TAURIC_DB_PATH ||
  path.join(process.cwd(), 'scanner', 'tauric.db')

type KronosRow = {
  symbol: string
  horizon: number
  forecast_json: string
  created_at: string
}

async function main() {
  console.log(`[sync-kronos] Reading ${DB_PATH}`)
  const db = new Database(DB_PATH, { readonly: true })

  const rows = db
    .prepare(
      `SELECT symbol, horizon, forecast_json, created_at
       FROM kronos_forecasts
       WHERE created_at > datetime('now', '-36 hours')
       ORDER BY created_at DESC`
    )
    .all() as KronosRow[]

  // Keep latest per symbol
  const latest = new Map<string, KronosRow>()
  for (const row of rows) {
    if (!latest.has(row.symbol)) latest.set(row.symbol, row)
  }

  let saved = 0
  for (const row of latest.values()) {
    let forecast: Prisma.InputJsonValue
    try {
      forecast = JSON.parse(row.forecast_json) as Prisma.InputJsonValue
    } catch {
      console.warn(`[sync-kronos] bad JSON for ${row.symbol}, skip`)
      continue
    }
    const sampleCount =
      typeof forecast === 'object' &&
      forecast &&
      'metadata' in forecast &&
      typeof (forecast as { metadata?: { sample_count?: number } }).metadata?.sample_count === 'number'
        ? (forecast as { metadata: { sample_count: number } }).metadata.sample_count
        : 5

    await saveForecastCache({
      symbol: row.symbol,
      horizon: row.horizon || 10,
      interval: '1d',
      sampleCount,
      forecast,
      generatedAt: new Date(row.created_at.includes('T') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z'),
    })
    saved++
    console.log(`[sync-kronos] saved ${row.symbol}`)
  }

  db.close()

  if (saved === 0) {
    throw new Error('No Kronos forecasts found in scanner/tauric.db to sync (last 36h)')
  }

  await createNotification(
    'forecast_ready',
    'AI Forecast Cache Ready',
    `Kronos cache synced for ${saved} symbol(s). Open AI Forecast or AI Score to view results.`,
    'success'
  )

  console.log(`[sync-kronos] Done — ${saved} forecasts synced to Turso`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[sync-kronos] Failed:', err)
    process.exit(1)
  })

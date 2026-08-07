/**
 * Create symbol_backtest_perf table on Turso (idempotent).
 *
 *   npx tsx --env-file=.env scripts/migrate-turso-symbol-backtest-perf.ts
 */
import 'dotenv/config'
import { createClient } from '@libsql/client'

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  if (!tursoUrl || !tursoToken) {
    throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env')
  }

  const client = createClient({ url: tursoUrl, authToken: tursoToken })

  const createTable = `
    CREATE TABLE IF NOT EXISTS symbol_backtest_perf (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      symbol TEXT NOT NULL,
      winRate REAL NOT NULL DEFAULT 50,
      totalTrades INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      avgPnlPct REAL NOT NULL DEFAULT 0,
      rangeStart DATETIME NOT NULL,
      rangeEnd DATETIME NOT NULL,
      years REAL NOT NULL DEFAULT 10,
      backtestId INTEGER,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `

  const createUnique = `
    CREATE UNIQUE INDEX IF NOT EXISTS symbol_backtest_perf_symbol_key
    ON symbol_backtest_perf(symbol)
  `

  const createUpdatedIdx = `
    CREATE INDEX IF NOT EXISTS symbol_backtest_perf_updatedAt_idx
    ON symbol_backtest_perf(updatedAt)
  `

  console.log(`Connecting to ${tursoUrl}`)
  await client.execute(createTable)
  console.log('OK: CREATE TABLE IF NOT EXISTS symbol_backtest_perf')
  await client.execute(createUnique)
  console.log('OK: unique index on symbol')
  await client.execute(createUpdatedIdx)
  console.log('OK: index on updatedAt')
  console.log('Turso symbol_backtest_perf migration done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

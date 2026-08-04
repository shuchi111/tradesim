/**
 * Import data from a JSON export into PostgreSQL/Supabase.
 *
 * Usage:
 *   1. Place the data_export/ folder in your project root
 *   2. Set DATABASE_URL in .env to your PostgreSQL/Supabase URL
 *   3. Run: npx tsx scripts/import-data.ts
 *
 * This script:
 *   - Reads all JSON files from data_export/
 *   - Inserts them into your database
 *   - Handles JSON columns correctly for PostgreSQL
 *   - Skips rows that already exist (idempotent)
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import 'dotenv/config'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || 'file:./prisma/tradesim.db',
  }),
})

// Tables in dependency order (parents before children)
const TABLE_ORDER = [
  'accounts',
  'auto_trade_config',
  'daily_reports',
  'notifications',
  'orders',
  'trades',
  'positions',
  'custom_strategy_trades',
  'trailing_stop_events',
  'backtests',
  'backtest_trades',
] as const

// JSON columns per table (Prisma handles these as Json type)
const JSON_COLUMNS: Record<string, string[]> = {
  daily_reports: ['metrics', 'tradesData', 'riskEvents', 'topWinners', 'topLosers', 'openPositions'],
  notifications: ['metadata'],
  trailing_stop_events: ['metadata'],
  custom_strategy_trades: ['entryDetails', 'exitDetails'],
  backtests: ['equityCurve', 'strategyStats'],
}

async function importTable(tableName: string) {
  const filePath = join(process.cwd(), 'data_export', `${tableName}.json`)
  
  let rawData: string
  try {
    rawData = readFileSync(filePath, 'utf-8')
  } catch {
    console.log(`  ⏭️  ${tableName}: no export file found, skipping`)
    return
  }

  const rows = JSON.parse(rawData)
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`  ⏭️  ${tableName}: empty, skipping`)
    return
  }

  console.log(`  📥 ${tableName}: ${rows.length} rows`)

  // Process JSON columns — convert stringified JSON back to objects
  const jsonCols = JSON_COLUMNS[tableName] || []
  for (const row of rows) {
    for (const col of jsonCols) {
      if (row[col] && typeof row[col] === 'string') {
        try {
          row[col] = JSON.parse(row[col])
        } catch {
          // leave as string if not valid JSON
        }
      }
    }
  }

  // Convert date strings to Date objects
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const val = row[key]
      if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T/) ) {
        row[key] = new Date(val)
      }
      if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
        row[key] = new Date(val.replace(' ', 'T') + 'Z')
      }
    }
  }

  // Use raw SQL for maximum compatibility across table name mappings
  // Prisma model names are camelCase, table names are snake_case
  const modelMap: Record<string, string> = {
    accounts: 'account',
    auto_trade_config: 'autoTradeConfig',
    daily_reports: 'dailyReport',
    notifications: 'notification',
    orders: 'order',
    trades: 'trade',
    positions: 'position',
    custom_strategy_trades: 'customStrategyTrade',
    trailing_stop_events: 'trailingStopEvent',
    backtests: 'backtest',
    backtest_trades: 'backtestTrade',
  }

  const modelName = modelMap[tableName]
  if (!modelName) {
    console.log(`  ⚠️  ${tableName}: unknown model, skipping`)
    return
  }

  // @ts-expect-error - dynamic model access
  const model = prisma[modelName]
  
  for (const row of rows) {
    try {
      await model.upsert({
        where: { id: row.id },
        update: row,
        create: row,
      })
    } catch (err) {
      // backtest_trades has composite relationship, try without id
      if (tableName === 'backtest_trades') {
        try {
          await model.create({ data: row })
        } catch {
          console.log(`    ⚠️  Skipped duplicate row in ${tableName}`)
        }
      } else {
        console.log(`    ⚠️  Error in ${tableName} row ${row.id}: ${err instanceof Error ? err.message.slice(0, 80) : err}`)
      }
    }
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  TradeSim Data Import (JSON → DB)        ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log()
  console.log(`Database: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[1] || 'unknown'}`)
  console.log()

  for (const table of TABLE_ORDER) {
    await importTable(table)
  }

  console.log()
  console.log('✅ Import complete!')

  // Verify
  const accountCount = await prisma.account.count()
  const positionCount = await prisma.position.count()
  const tradeCount = await prisma.customStrategyTrade.count()
  console.log(`   Accounts: ${accountCount}`)
  console.log(`   Positions: ${positionCount}`)
  console.log(`   Closed trades: ${tradeCount}`)
}

main()
  .catch((err) => {
    console.error('❌ Import failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

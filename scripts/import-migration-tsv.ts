/**
 * Import migration/*.tsv into local SQLite (prisma/tradesim.db).
 * Run: npx tsx --env-file=.env scripts/import-migration-tsv.ts
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'
import 'dotenv/config'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || 'file:./prisma/tradesim.db',
  }),
})

function parseTsv(file: string): Record<string, string>[] {
  const path = join(process.cwd(), 'migration', file)
  const text = readFileSync(path, 'utf-8').trim()
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const headers = lines[0].split('\t')
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split('\t')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? ''
    })
    return row
  })
}

function num(v: string | undefined, fallback = 0): number {
  if (v == null || v === '' || v === 'NULL') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function bool(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true'
}

function dateOrNull(v: string | undefined): Date | null {
  if (!v || v === 'NULL') return null
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

function jsonOrNull(v: string | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!v || v === 'NULL' || v === 'null') return Prisma.JsonNull
  try {
    return JSON.parse(v) as Prisma.InputJsonValue
  } catch {
    return Prisma.JsonNull
  }
}

async function main() {
  console.log('Importing migration TSV → SQLite...')

  // Clear existing trading data (keep schema)
  await prisma.trailingStopEvent.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.trade.deleteMany()
  await prisma.position.deleteMany()
  await prisma.order.deleteMany()
  await prisma.riskSnapshot.deleteMany()
  await prisma.backtestTrade.deleteMany()
  await prisma.backtest.deleteMany()

  const accounts = parseTsv('accounts.tsv')
  for (const row of accounts) {
    const sipAmount = num(row.sipAmountInr, 20000)
    const lastSip = dateOrNull(row.lastSipDate)
    const totalDeposited = lastSip ? sipAmount : 0
    await prisma.account.upsert({
      where: { id: num(row.id, 1) },
      create: {
        id: num(row.id, 1),
        balance: num(row.balance),
        startingEquity: num(row.startingEquity, 100000),
        sipAmountInr: sipAmount,
        lastSipDate: lastSip,
        totalDeposited,
        createdAt: dateOrNull(row.createdAt) ?? new Date(),
      },
      update: {
        balance: num(row.balance),
        startingEquity: num(row.startingEquity, 100000),
        sipAmountInr: sipAmount,
        lastSipDate: lastSip,
        totalDeposited,
      },
    })
  }
  console.log(`  accounts: ${accounts.length}`)

  const configs = parseTsv('auto_trade_config.tsv')
  for (const row of configs) {
    await prisma.autoTradeConfig.upsert({
      where: { id: num(row.id, 1) },
      create: {
        id: num(row.id, 1),
        enabled: bool(row.enabled),
        updatedAt: dateOrNull(row.updatedAt) ?? new Date(),
      },
      update: {
        enabled: bool(row.enabled),
        updatedAt: dateOrNull(row.updatedAt) ?? new Date(),
      },
    })
  }
  console.log(`  auto_trade_config: ${configs.length}`)

  const positions = parseTsv('positions.tsv')
  for (const row of positions) {
    await prisma.position.create({
      data: {
        symbol: row.symbol,
        side: row.side,
        entryPrice: num(row.entryPrice),
        quantity: num(row.quantity),
        peakPrice: num(row.peakPrice),
        troughPrice: num(row.troughPrice),
        partialExitTaken: bool(row.partialExitTaken),
        createdAt: dateOrNull(row.createdAt) ?? new Date(),
      },
    })
  }
  console.log(`  positions: ${positions.length}`)

  const trades = parseTsv('trades.tsv')
  for (const row of trades) {
    await prisma.trade.create({
      data: {
        orderId: row.orderId === 'NULL' || !row.orderId ? null : num(row.orderId),
        symbol: row.symbol,
        side: row.side,
        price: num(row.price),
        quantity: num(row.quantity),
        createdAt: dateOrNull(row.createdAt) ?? new Date(),
      },
    })
  }
  console.log(`  trades: ${trades.length}`)

  const notes = parseTsv('notifications.tsv')
  for (const row of notes) {
    await prisma.notification.create({
      data: {
        type: row.type,
        symbol: row.symbol === 'NULL' ? null : row.symbol,
        title: row.title,
        message: row.message,
        severity: row.severity || 'info',
        isRead: bool(row.isRead),
        metadata: jsonOrNull(row.metadata),
        createdAt: dateOrNull(row.createdAt) ?? new Date(),
      },
    })
  }
  console.log(`  notifications: ${notes.length}`)

  const events = parseTsv('trailing_stop_events.tsv')
  for (const row of events) {
    await prisma.trailingStopEvent.create({
      data: {
        tradeId: row.tradeId === 'NULL' || !row.tradeId ? null : num(row.tradeId),
        symbol: row.symbol,
        eventType: row.eventType,
        entryPrice: num(row.entryPrice),
        currentPrice: num(row.currentPrice),
        peakPrice: num(row.peakPrice),
        pnlPct: num(row.pnlPct),
        peakGainPct: num(row.peakGainPct),
        triggerReason: row.triggerReason,
        timestamp: dateOrNull(row.timestamp) ?? new Date(),
        metadata: jsonOrNull(row.metadata),
      },
    })
  }
  console.log(`  trailing_stop_events: ${events.length}`)

  const risks = parseTsv('risk_snapshots.tsv')
  for (const row of risks) {
    await prisma.riskSnapshot.create({
      data: {
        snapshotDate: dateOrNull(row.timestamp) ?? new Date(),
        totalEquity: num(row.equity),
        cashAvailable: num(row.cash),
        positionsCount: num(row.positionsCount),
        positionsValue: num(row.positionsValue),
        dailyPnl: num(row.dailyPnl),
        drawdownPct: num(row.drawdownPct),
        createdAt: dateOrNull(row.timestamp) ?? new Date(),
      },
    })
  }
  console.log(`  risk_snapshots: ${risks.length}`)

  const account = await prisma.account.findUnique({ where: { id: 1 } })
  const posCount = await prisma.position.count()
  console.log(`Done. balance=${account?.balance}, positions=${posCount}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

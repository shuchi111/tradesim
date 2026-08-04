/**
 * Import trading data from a JSON dump (tmp-remote-data/) into DATABASE_URL.
 * Usage: npx tsx scripts/import-remote-data.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./prisma/tradesim.db',
})
const prisma = new PrismaClient({ adapter })

const dir = path.join(process.cwd(), 'tmp-remote-data')

function load<T>(name: string): T {
  const raw = fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(raw)
}

async function main() {
  const account = load<{ data: { balance: number; startingEquity: number } }>('account.json').data
  const positions = load<{ data: Array<Record<string, unknown>> }>('positions.json').data
  const trades = load<{ data: Array<Record<string, unknown>> }>('trades.json').data
  const closed = load<{ data: Array<Record<string, unknown>> }>('closed.json').data
  const orders = load<{ data: Array<Record<string, unknown>> }>('orders.json').data

  console.log('Clearing tables...')
  await prisma.customStrategyTrade.deleteMany()
  await prisma.trade.deleteMany()
  await prisma.order.deleteMany()
  await prisma.position.deleteMany()
  await prisma.account.deleteMany()

  console.log('Importing account...')
  await prisma.account.create({
    data: {
      id: 1,
      balance: account.balance,
      startingEquity: account.startingEquity,
    },
  })

  if (orders.length) {
    console.log(`Importing ${orders.length} orders...`)
    for (const o of orders) {
      await prisma.order.create({
        data: {
          id: o.id as number,
          symbol: o.symbol as string,
          side: o.side as string,
          type: o.type as string,
          price: o.price as number,
          quantity: o.quantity as number,
          status: (o.status as string) || 'pending',
          createdAt: new Date(o.createdAt as string),
        },
      })
    }
  }

  console.log(`Importing ${trades.length} trades...`)
  for (const t of trades) {
    await prisma.trade.create({
      data: {
        id: t.id as number,
        orderId: (t.orderId as number | null) ?? null,
        symbol: t.symbol as string,
        side: t.side as string,
        price: t.price as number,
        quantity: t.quantity as number,
        createdAt: new Date(t.createdAt as string),
      },
    })
  }

  console.log(`Importing ${positions.length} positions...`)
  for (const p of positions) {
    await prisma.position.create({
      data: {
        id: p.id as number,
        symbol: p.symbol as string,
        side: p.side as string,
        entryPrice: p.entryPrice as number,
        quantity: p.quantity as number,
        peakPrice: (p.peakPrice as number) ?? 0,
        troughPrice: (p.troughPrice as number) ?? 0,
        partialExitTaken: (p.partialExitTaken as boolean) ?? false,
        createdAt: new Date(p.createdAt as string),
      },
    })
  }

  console.log(`Importing ${closed.length} closed strategy trades...`)
  for (const c of closed) {
    await prisma.customStrategyTrade.create({
      data: {
        id: c.id as number,
        symbol: c.symbol as string,
        side: c.side as string,
        entryPrice: c.entryPrice as number,
        exitPrice: c.exitPrice as number,
        quantity: c.quantity as number,
        pnl: c.pnl as number,
        openedAt: new Date(c.openedAt as string),
        closedAt: new Date(c.closedAt as string),
      },
    })
  }

  const counts = {
    account: await prisma.account.count(),
    positions: await prisma.position.count(),
    trades: await prisma.trade.count(),
    closed: await prisma.customStrategyTrade.count(),
    orders: await prisma.order.count(),
  }
  const localAccount = await prisma.account.findUnique({ where: { id: 1 } })
  console.log('Import complete:', counts)
  console.log(`Balance: $${localAccount?.balance.toFixed(2)} | Starting: $${localAccount?.startingEquity}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

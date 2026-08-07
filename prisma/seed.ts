import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./prisma/tradesim.db',
})
const prisma = new PrismaClient({ adapter })

const STARTING_BALANCE = 100000 // ₹1,00,000 (1 Lakh INR)

function firstOfCurrentIstMonth(from: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(from)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  return new Date(Date.UTC(year, month - 1, 1, 6, 30, 0))
}

async function main() {
  await prisma.account.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      balance: STARTING_BALANCE,
      startingEquity: STARTING_BALANCE,
      sipAmountInr: 20000,
      sipDayOfMonth: 7,
      sipEligibleFrom: firstOfCurrentIstMonth(),
    },
  })

  await prisma.autoTradeConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, enabled: false },
  })

  console.log(
    `Seed complete: account ₹${STARTING_BALANCE.toLocaleString('en-IN')} + auto-trade config ready`
  )
}

main()

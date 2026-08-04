import { PrismaClient } from '@prisma/client'
<<<<<<< HEAD
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./prisma/tradesim.db',
})
const prisma = new PrismaClient({ adapter })

const STARTING_BALANCE = 100000 // ₹1,00,000 (1 Lakh INR)
=======
import { STARTING_BALANCE_INR } from './seed-data'

const prisma = new PrismaClient()
>>>>>>> 4f995f654159cdd8ee57d0b8d7da1593ae3aecc3

async function main() {
  await prisma.account.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      balance: STARTING_BALANCE_INR,
      startingEquity: STARTING_BALANCE_INR,
      sipAmountInr: 20000,
    },
  })
<<<<<<< HEAD
=======

>>>>>>> 4f995f654159cdd8ee57d0b8d7da1593ae3aecc3
  await prisma.autoTradeConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, enabled: false },
  })
<<<<<<< HEAD
  console.log(`Seed complete: account ₹${STARTING_BALANCE.toLocaleString('en-IN')} + auto-trade config ready`)
=======

  console.log(`Seed complete: account created with ₹${STARTING_BALANCE_INR.toLocaleString('en-IN')} balance + auto-trade config ready`)
>>>>>>> 4f995f654159cdd8ee57d0b8d7da1593ae3aecc3
}

main()

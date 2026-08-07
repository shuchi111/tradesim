/**
 * Reset paper portfolio to ₹1,00,000 on the configured DB (Turso if set).
 * Clears open positions + pending orders; SIP on the 7th of each IST month.
 *
 *   npx tsx --env-file=.env scripts/reset-portfolio.ts
 */
import "dotenv/config"
import { resetPortfolio, STARTING_BALANCE, SIP_AMOUNT_INR, SIP_DAY_OF_MONTH } from "../src/lib/trading"
import { prisma } from "../src/lib/prisma"

async function main() {
  const target = process.env.TURSO_DATABASE_URL
    ? `Turso (${process.env.TURSO_DATABASE_URL})`
    : `local SQLite (${process.env.DATABASE_URL || "file:./prisma/tradesim.db"})`

  console.log(`Resetting portfolio on ${target}`)
  const result = await resetPortfolio()

  const positions = await prisma.position.count()
  const pending = await prisma.order.count({ where: { status: "pending" } })

  console.log({
    balance: result.balance,
    startingEquity: STARTING_BALANCE,
    sipAmountInr: result.sipAmountInr ?? SIP_AMOUNT_INR,
    sipDayOfMonth: result.sipDayOfMonth ?? SIP_DAY_OF_MONTH,
    sipEligibleFrom: result.sipEligibleFrom,
    openPositions: positions,
    pendingOrders: pending,
  })
  console.log("Portfolio reset complete.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

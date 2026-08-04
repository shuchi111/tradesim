/**
 * 1) Apply schema SQL to Turso
 * 2) Copy rows from local SQLite → Turso
 *
 *   npx tsx --env-file=.env scripts/migrate-sqlite-to-turso.ts
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@libsql/client"
import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaLibSql } from "@prisma/adapter-libsql"

const TABLES = [
  "account",
  "order",
  "trade",
  "position",
  "customStrategyTrade",
  "trailingStopEvent",
  "dailyReport",
  "notification",
  "backtest",
  "backtestTrade",
  "autoTradeConfig",
  "agentAnalysis",
  "forecastCache",
  "scannerScan",
  "autoTradeRun",
  "marketSnapshot",
  "strategyPerf",
  "riskSnapshot",
  "scanResult",
] as const

async function applySchema(tursoUrl: string, tursoToken: string) {
  const sqlPath = path.join(process.cwd(), "prisma", "turso-init.sql")
  if (!fs.existsSync(sqlPath)) {
    throw new Error("Missing prisma/turso-init.sql — run: npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script -o prisma/turso-init.sql")
  }

  const client = createClient({ url: tursoUrl, authToken: tursoToken })
  const raw = fs.readFileSync(sqlPath, "utf8")

  // Split on statement boundaries; skip empty / comment-only chunks
  const statements = raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim().startsWith("--") || l.trim() === ""))

  console.log(`Applying ${statements.length} SQL statements to Turso...`)
  for (const stmt of statements) {
    try {
      await client.execute(stmt)
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      // Idempotent re-runs
      if (msg.includes("already exists")) {
        console.log(`  skip (exists): ${stmt.slice(0, 60)}...`)
        continue
      }
      throw e
    }
  }
  console.log("Schema applied.")
}

async function copyData(tursoUrl: string, tursoToken: string) {
  const localUrl = process.env.DATABASE_URL || "file:./prisma/tradesim.db"
  const local = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: localUrl }),
  })
  const remote = new PrismaClient({
    adapter: new PrismaLibSql({ url: tursoUrl, authToken: tursoToken }),
  })

  try {
    for (const model of TABLES) {
      const from = (local as any)[model]
      const to = (remote as any)[model]
      if (!from?.findMany || !to?.createMany) {
        console.log(`  skip ${model}`)
        continue
      }
      const rows = await from.findMany()
      if (rows.length === 0) {
        console.log(`  ${model}: 0`)
        continue
      }
      await to.deleteMany({})
      // Insert in chunks (Turso has request size limits)
      const chunk = 50
      for (let i = 0; i < rows.length; i += chunk) {
        await to.createMany({ data: rows.slice(i, i + chunk) })
      }
      console.log(`  ${model}: ${rows.length}`)
    }
    console.log("Data copy done.")
  } finally {
    await local.$disconnect()
    await remote.$disconnect()
  }
}

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  if (!tursoUrl || !tursoToken) {
    throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env")
  }

  await applySchema(tursoUrl, tursoToken)
  await copyData(tursoUrl, tursoToken)

  // Smoke test
  const remote = new PrismaClient({
    adapter: new PrismaLibSql({ url: tursoUrl, authToken: tursoToken }),
  })
  try {
    const account = await remote.account.findUnique({ where: { id: 1 } })
    const positions = await remote.position.count()
    console.log("Smoke test:", {
      balance: account?.balance,
      totalDeposited: account?.totalDeposited,
      positions,
    })
  } finally {
    await remote.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const token = process.env.TURSO_AUTH_TOKEN
  if (!url) throw new Error("missing TURSO_DATABASE_URL")

  console.log("connecting to", url)
  const prisma = new PrismaClient({
    adapter: new PrismaLibSql({ url, authToken: token }),
  })

  try {
    const tables = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    console.log("tables:", tables)

    try {
      const accounts = await prisma.account.findMany()
      console.log("accounts:", accounts.length, accounts[0] ? { id: accounts[0].id, balance: accounts[0].balance } : null)
    } catch (e: any) {
      console.log("account query error:", e.message)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

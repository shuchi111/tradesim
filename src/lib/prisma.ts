import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN

  // Prefer Turso when credentials are present (must match Next.js + CI scripts)
  if (tursoUrl) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[prisma] Using Turso database')
    }
    const adapter = new PrismaLibSql({
      url: tursoUrl,
      authToken: tursoToken,
    })
    return new PrismaClient({ adapter })
  }

  // Local SQLite fallback (dev without Turso)
  const url = process.env.DATABASE_URL || 'file:./prisma/tradesim.db'
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[prisma] Turso env missing — using local SQLite:', url)
  }
  const adapter = new PrismaBetterSqlite3({ url })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

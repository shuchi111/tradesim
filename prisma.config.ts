import "dotenv/config"
import path from "node:path"
import { defineConfig } from "prisma/config"

/**
 * Prisma CLI (generate / migrate / db push) always targets local SQLite.
 * App runtime uses Turso via @prisma/adapter-libsql in src/lib/prisma.ts.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL || "file:./prisma/tradesim.db",
  },
})

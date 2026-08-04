/**
 * Apply incremental Account SIP columns to Turso (idempotent).
 *
 *   npx tsx --env-file=.env scripts/migrate-turso-sip-columns.ts
 */
import "dotenv/config"
import { createClient } from "@libsql/client"

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  if (!tursoUrl || !tursoToken) {
    throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env")
  }

  const client = createClient({ url: tursoUrl, authToken: tursoToken })

  const statements = [
    `ALTER TABLE accounts ADD COLUMN sipDayOfMonth INTEGER NOT NULL DEFAULT 5`,
    `ALTER TABLE accounts ADD COLUMN sipEligibleFrom DATETIME`,
  ]

  console.log(`Connecting to ${tursoUrl}`)

  for (const stmt of statements) {
    try {
      await client.execute(stmt)
      console.log(`OK: ${stmt}`)
    } catch (e: unknown) {
      const msg = String(e instanceof Error ? e.message : e)
      if (/duplicate column|already exists/i.test(msg)) {
        console.log(`skip (exists): ${stmt}`)
        continue
      }
      throw e
    }
  }

  // Backfill: existing accounts with prior SIP stay eligible; others start next month.
  // App-side ensureAccount also backfills sipEligibleFrom when null.
  const info = await client.execute(`PRAGMA table_info(accounts)`)
  console.log(
    "accounts columns:",
    info.rows.map((r) => r.name).join(", ")
  )

  // Existing SIP users: mark eligible so monthly deposits continue on the 5th
  await client.execute({
    sql: `UPDATE accounts
          SET sipEligibleFrom = '2000-01-01T00:00:00.000Z'
          WHERE sipEligibleFrom IS NULL
            AND (lastSipDate IS NOT NULL OR IFNULL(totalDeposited, 0) > 0)`,
    args: [],
  })

  const sample = await client.execute(
    `SELECT id, balance, sipAmountInr, sipDayOfMonth, sipEligibleFrom, lastSipDate, totalDeposited FROM accounts WHERE id = 1`
  )
  console.log("account id=1:", sample.rows[0] ?? "(none)")
  console.log("Turso SIP columns migration done.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

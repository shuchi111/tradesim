/**
 * Quant / finance PR review for TradeSim.
 *
 * Scans changed (or full) trading-critical files for guardrail regressions:
 * whole-share qty, cash reserve, ₹25k max allocation, SIP ≠ P&L,
 * max positions as cap (not forced fill), sell penalty, look-ahead risk.
 *
 * Usage:
 *   npx tsx scripts/ci/pr-quant-review.ts
 *   npx tsx scripts/ci/pr-quant-review.ts --base origin/main --head HEAD
 *   npx tsx scripts/ci/pr-quant-review.ts --all
 *
 * Exit 1 if any blocker findings.
 */
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

type Severity = "blocker" | "major" | "minor" | "info"

interface Finding {
  severity: Severity
  file: string
  line?: number
  rule: string
  message: string
}

const TRADING_GLOBS = [
  /^src\/lib\/trading\.ts$/,
  /^src\/lib\/backtest\.ts$/,
  /^src\/lib\/strategy\.ts$/,
  /^src\/lib\/metrics\.ts$/,
  /^src\/lib\/ml\//,
  /^src\/app\/api\/(orders|account|backtest|strategy|risk)\//,
  /^src\/components\/(TradingPanel|StrategyPanel|tabs\/(Wallet|Strategy|Holdings))/,
  /^tests\/(trading|backtest|strategy)\.test\.ts$/,
  /^prisma\/schema\.prisma$/,
  /^scripts\/(reset-portfolio|migrate-turso|ci)\//,
]

const REQUIRED_CONSTANTS: Array<{ name: string; hint: string }> = [
  { name: "STARTING_BALANCE", hint: "₹1,00,000 starting capital" },
  { name: "SIP_AMOUNT_INR", hint: "₹20,000 monthly SIP" },
  { name: "SIP_DAY_OF_MONTH", hint: "fixed SIP calendar day (IST)" },
  { name: "CASH_RESERVE_PCT", hint: "minimum wallet cash reserve" },
  { name: "MAX_POSITIONS_ALLOWED", hint: "unlimited positions (Infinity/null)" },
]

function parseArgs() {
  const args = process.argv.slice(2)
  const all = args.includes("--all")
  const baseIdx = args.indexOf("--base")
  const headIdx = args.indexOf("--head")
  const base =
    baseIdx >= 0
      ? args[baseIdx + 1]
      : process.env.GITHUB_BASE_SHA ||
        process.env.PR_BASE_SHA ||
        "origin/main"
  const head =
    headIdx >= 0
      ? args[headIdx + 1]
      : process.env.GITHUB_SHA || process.env.PR_HEAD_SHA || "HEAD"
  return { all, base, head }
}

function git(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    }).trim()
  } catch {
    return ""
  }
}

function listChangedFiles(base: string, head: string): string[] {
  // Prefer triple-dot merge-base diff (PR style)
  let out = git(`git diff --name-only --diff-filter=ACMR ${base}...${head}`)
  if (!out) out = git(`git diff --name-only --diff-filter=ACMR ${base} ${head}`)
  if (!out) out = git(`git diff --name-only --diff-filter=ACMR HEAD~1 HEAD`)
  return out
    .split("\n")
    .map((f) => f.trim().replace(/\\/g, "/"))
    .filter(Boolean)
}

function isTradingCritical(file: string): boolean {
  return TRADING_GLOBS.some((re) => re.test(file))
}

function readFile(file: string): string | null {
  const abs = path.join(process.cwd(), file)
  if (!fs.existsSync(abs)) return null
  return fs.readFileSync(abs, "utf8")
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length
}

function findMatches(
  file: string,
  content: string,
  pattern: RegExp,
  severity: Severity,
  rule: string,
  message: string
): Finding[] {
  const findings: Finding[] = []
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
  const re = new RegExp(pattern.source, flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    findings.push({
      severity,
      file,
      line: lineOf(content, m.index),
      rule,
      message,
    })
  }
  return findings
}

function analyzeFile(file: string, content: string): Finding[] {
  const findings: Finding[] = []
  const isCore =
    file === "src/lib/trading.ts" || file === "src/lib/backtest.ts"

  // --- Fractional quantity anti-patterns ---
  if (isCore || file.includes("orders")) {
    findings.push(
      ...findMatches(
        file,
        content,
        /qty\s*=\s*allocation\s*\/\s*price(?!\s*[;\n]*[\s\S]{0,80}Math\.floor)/,
        "blocker",
        "whole-shares",
        "Quantity looks fractional (allocation/price without Math.floor). Use whole shares only."
      )
    )
    findings.push(
      ...findMatches(
        file,
        content,
        /quantity\s*\*\s*0\.5|pos\.quantity\s*\*\s*0\.5/,
        "major",
        "whole-shares-partial",
        "Partial exit uses fraction of quantity — prefer Math.floor(qty / 2) for whole shares."
      )
    )
  }

  // --- Confidence-scaled sizing (no fixed ₹ / score gates) ---
  if (file === "src/lib/trading.ts" || file === "src/lib/backtest.ts") {
    if (!/allocationPctFromConfidence/.test(content)) {
      findings.push({
        severity: "blocker",
        file,
        rule: "confidence-sizing",
        message:
          "Missing allocationPctFromConfidence — buys must scale size by confidence (low→small, high→large).",
      })
    }
    if (!/CASH_RESERVE_PCT|0\.30|0\.3\b/.test(content)) {
      findings.push({
        severity: "blocker",
        file,
        rule: "cash-reserve",
        message:
          "Missing 30% cash reserve / minimum wallet balance check before buys.",
      })
    }
    if (!/Math\.floor/.test(content) && /allocation\s*\/\s*/.test(content)) {
      findings.push({
        severity: "blocker",
        file,
        rule: "whole-shares",
        message: "Position sizing divides money by price but never Math.floor — fractional qty risk.",
      })
    }
  }

  // --- Forced max positions (anti-pattern: always open N) ---
  findings.push(
    ...findMatches(
      file,
      content,
      /while\s*\(\s*(positions|activePositions)\.length\s*<\s*(MAX_POSITIONS|maxPositions|8)/,
      "major",
      "no-force-fill",
      "Loop forces filling up to a fixed position count. Do not force-open trades to fill slots."
    )
  )

  // --- SIP treated as P&L ---
  if (file.includes("metrics") || file.includes("trading") || file.includes("StatsBar")) {
    findings.push(
      ...findMatches(
        file,
        content,
        /totalPnl\s*=\s*.*totalDeposited|pnl\s*\+=\s*.*sip|sipAmount.*pnl/i,
        "blocker",
        "sip-not-pnl",
        "Possible SIP/deposit counted as P&L. SIP is capital injection, not profit."
      )
    )
  }

  // --- Look-ahead / future bars in backtest ---
  if (file.includes("backtest")) {
    findings.push(
      ...findMatches(
        file,
        content,
        /klines\s*\[\s*barIndex\s*\+\s*[1-9]/,
        "major",
        "lookahead",
        "Possible look-ahead: reading future barIndex+N in backtest. Use only data available at decision time."
      )
    )
  }

  // --- Secrets / hard-coded tokens ---
  findings.push(
    ...findMatches(
      file,
      content,
      /TURSO_AUTH_TOKEN\s*=\s*["']eyJ|sk-[a-zA-Z0-9]{20,}|api[_-]?key\s*=\s*["'][a-zA-Z0-9]{20,}/i,
      "blocker",
      "secrets",
      "Hard-coded secret/token detected. Use env vars / GitHub secrets only."
    )
  )

  // --- Sell without penalty awareness (info when editing sell path) ---
  if (
    isCore &&
    /side\s*===\s*['"]sell['"]|processFill\(.*sell/.test(content) &&
    !/SELL_PENALTY|sellPenalty|150/.test(content)
  ) {
    findings.push({
      severity: "minor",
      file,
      rule: "sell-penalty",
      message:
        "Sell path edited — confirm flat ₹150 sell penalty still applied to net proceeds.",
    })
  }

  // --- Confidence gates regression ---
  if (file.includes("trading.ts") || file.includes("backtest.ts")) {
    if (/minConfidence\s*=\s*\d+/.test(content)) {
      const low = content.match(/minConfidence\s*=\s*(\d+)/g) || []
      for (const hit of low) {
        const n = Number(hit.replace(/\D/g, ""))
        if (n < 60) {
          findings.push({
            severity: "major",
            file,
            rule: "confidence-gate",
            message: `Very low minConfidence (${n}). Live policy is 70 (multi) / 80 (single).`,
          })
        }
      }
    }
  }

  return findings
}

function analyzeTradingTsConstants(content: string | null): Finding[] {
  if (!content) return []
  const findings: Finding[] = []
  for (const c of REQUIRED_CONSTANTS) {
    if (!new RegExp(`\\b${c.name}\\b`).test(content)) {
      findings.push({
        severity: "blocker",
        file: "src/lib/trading.ts",
        rule: "required-constant",
        message: `Missing exported/defined constant ${c.name} (${c.hint}).`,
      })
    }
  }
  // Value sanity checks when present
  const reserve = content.match(/CASH_RESERVE_PCT\s*=\s*(0\.\d+)/)
  if (reserve && Number(reserve[1]) < 0.15) {
    findings.push({
      severity: "major",
      file: "src/lib/trading.ts",
      rule: "cash-reserve-value",
      message: `CASH_RESERVE_PCT=${reserve[1]} is below 15% — wallet may be over-deployed.`,
    })
  }
  return findings
}

function severityRank(s: Severity): number {
  return { blocker: 0, major: 1, minor: 2, info: 3 }[s]
}

function renderMarkdown(
  findings: Finding[],
  files: string[],
  meta: { base: string; head: string; mode: string }
): string {
  const blockers = findings.filter((f) => f.severity === "blocker")
  const majors = findings.filter((f) => f.severity === "major")
  const minors = findings.filter((f) => f.severity === "minor" || f.severity === "info")

  const lines: string[] = []
  lines.push("## TradeSim Quant / Finance PR Review")
  lines.push("")
  lines.push(
    `_Mode: \`${meta.mode}\` · base \`${meta.base}\` → head \`${meta.head}\`_`
  )
  lines.push("")
  lines.push("### Portfolio policy checklist")
  lines.push("")
  lines.push("| Guardrail | Expected |")
  lines.push("|-----------|----------|")
  lines.push("| Starting capital | ₹1,00,000 |")
  lines.push("| SIP | ₹20,000 on 7th IST, subsequent month after reset |")
  lines.push("| Cash reserve | 30% of starting equity (min wallet) |")
  lines.push("| Max per trade | ₹25,000 hard cap |")
  lines.push("| Quantity | Whole shares only (no fractions) |")
  lines.push("| Open positions | Max 8 ceiling — **not** forced fill |")
  lines.push("| SIP vs P&L | Deposits are capital, never profit |")
  lines.push("| Sell cost | Flat ₹150 penalty |")
  lines.push("")

  lines.push(`### Changed trading-critical files (${files.length})`)
  lines.push("")
  if (files.length === 0) {
    lines.push("_No trading-critical files in this diff._")
  } else {
    for (const f of files) lines.push(`- \`${f}\``)
  }
  lines.push("")

  lines.push("### Findings")
  lines.push("")
  lines.push(
    `| Severity | Count |`
  )
  lines.push(`|----------|-------|`)
  lines.push(`| 🔴 Blocker | ${blockers.length} |`)
  lines.push(`| 🟠 Major | ${majors.length} |`)
  lines.push(`| 🟡 Minor/Info | ${minors.length} |`)
  lines.push("")

  if (findings.length === 0) {
    lines.push("✅ No quant/finance guardrail regressions detected in scanned files.")
  } else {
    const sorted = [...findings].sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity)
    )
    for (const f of sorted) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file
      const icon =
        f.severity === "blocker"
          ? "🔴"
          : f.severity === "major"
            ? "🟠"
            : f.severity === "minor"
              ? "🟡"
              : "ℹ️"
      lines.push(`- ${icon} **[${f.severity}]** \`${loc}\` — \`${f.rule}\`: ${f.message}`)
    }
  }

  lines.push("")
  lines.push("---")
  lines.push(
    "_Generated by `scripts/ci/pr-quant-review.ts`. Comment `cursor review` / `bugbot run` for AI deep review._"
  )
  return lines.join("\n")
}

function main() {
  const { all, base, head } = parseArgs()
  const mode = all ? "full-scan" : "pr-diff"

  let files: string[]
  if (all) {
    files = []
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === ".next" || ent.name === ".git")
          continue
        const p = path.join(dir, ent.name).replace(/\\/g, "/")
        if (ent.isDirectory()) walk(p)
        else if (isTradingCritical(p)) files.push(p)
      }
    }
    walk(".")
  } else {
    files = listChangedFiles(base, head).filter(isTradingCritical)
  }

  const findings: Finding[] = []

  // Always validate trading.ts constants when that file is in scope or on --all
  const tradingTs =
    files.includes("src/lib/trading.ts") || all
      ? readFile("src/lib/trading.ts")
      : null
  if (tradingTs) {
    findings.push(...analyzeTradingTsConstants(tradingTs))
  }

  for (const file of files) {
    const content = readFile(file)
    if (!content) continue
    findings.push(...analyzeFile(file, content))
  }

  // Deduplicate
  const seen = new Set<string>()
  const unique = findings.filter((f) => {
    const key = `${f.severity}|${f.file}|${f.line}|${f.rule}|${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const md = renderMarkdown(unique, files, { base, head, mode })
  const outDir = path.join(process.cwd(), "artifacts")
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, "pr-quant-review.md")
  fs.writeFileSync(outPath, md, "utf8")
  console.log(md)
  console.log(`\nWrote ${outPath}`)

  const blockers = unique.filter((f) => f.severity === "blocker").length
  if (blockers > 0) {
    console.error(`\nFAIL: ${blockers} blocker finding(s)`)
    process.exit(1)
  }
  console.log("\nPASS: no blocker findings")
}

main()

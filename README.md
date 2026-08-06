# TradeSim

Paper trading platform for Indian equities — live charts, wallet, multi-strategy auto-trade, Kronos forecasts, and agent analysis.

## Prerequisites


| Tool        | Version         | Notes                                                                                                  |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| **Node.js** | **22 LTS**      | Node 24+ can break `better-sqlite3` native builds on Windows                                           |
| **npm**     | comes with Node |                                                                                                        |
| **uv**      | latest          | [Install uv](https://docs.astral.sh/uv/getting-started/installation/) — manages the Python scanner env |
| **Python**  | **3.12**        | Pinned in `.python-version` / `pyproject.toml` (`>=3.12,<3.13`)                                        |


Optional on Windows if `better-sqlite3` fails to install: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**. Prefer switching to Node 22 instead.

## Quick start (Next.js app)

```bash
cd tradesim

# 1. Env
copy .env-example .env   # Windows
# cp .env-example .env   # macOS/Linux

# 2. JS deps + Prisma client
npm install
npx prisma generate
npx prisma db push

# 3. App
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Python scanner (forecast / Tauric / Kronos)

Scanner deps live in the **repo root** (`pyproject.toml`, `.venv`), not under `scanner/`.

### First-time setup

```bash
# Install Python deps (FastAPI, yfinance 1.5.2, torch, …)
npm run scanner:sync
# same as: uv sync
```

**Torch (CPU)** is required for Kronos forecasts. `pyproject.toml` pulls it from the [PyTorch CPU index](https://download.pytorch.org/whl/cpu) (works on Windows and Linux CI).

```bash
npm run scanner:sync
# same as: uv sync
```

Optional: cache a local wheel under `wheels/` for offline installs; CI does not use that path.

### Run the scanner

```bash
npm run scanner
```

Listens on [http://localhost:8000](http://localhost:8000) (override with `SCANNER_PORT`).

- `npm run scanner` uses `uv run --no-sync` so it **does not re-download** deps every start.
- Run `npm run scanner:sync` only when `pyproject.toml` / lockfile changes.

First Kronos forecast can take ~20–40s (model load). Later requests in the same process are faster.

If port 8000 is already in use, stop the old Python process or change `SCANNER_PORT`.

## Auto-trade loop

With the app (and usually the scanner) running:

```bash
npm run autotrade
```

Polls every 2 minutes during NSE hours when auto-trade is enabled in the DB.

## Typical local layout (3 terminals)

```bash
npm run dev        # :3000 — UI + APIs
npm run scanner    # :8000 — forecast / scan / Kronos
npm run autotrade  # background strategy loop
```

Optional: set `NEXT_PUBLIC_SCANNER_URL=http://localhost:8000` so the AI Forecast tab talks to the scanner directly (avoids Next.js proxy timeouts on long runs). Default is already `http://localhost:8000`.

## Environment

Copy `.env-example` → `.env` (never commit secrets). Minimum:

```env
# Local SQLite (used only if Turso vars are missing)
DATABASE_URL="file:./prisma/tradesim.db"

# Turso (preferred) — from https://turso.tech dashboard
TURSO_DATABASE_URL="libsql://YOUR-DB-NAME-YOUR-ORG.turso.io"
TURSO_AUTH_TOKEN="eyJ..."

NEXT_PUBLIC_APP_NAME="TradeSim"
SCANNER_PORT=8000
# NEXT_PUBLIC_SCANNER_URL=http://localhost:8000
```

When `TURSO_DATABASE_URL` is set, the **app** uses Turso. Prisma CLI (`db push` / migrate) always uses local SQLite.

### Migrate schema to Turso

**Full init / copy local → Turso** (wipes Turso tables then copies from local SQLite):

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script -o prisma/turso-init.sql
npx tsx --env-file=.env scripts/migrate-sqlite-to-turso.ts
```

**SIP columns only** (safe `ALTER TABLE`, no data wipe) — run after pulling Account SIP fields:

```bash
npx tsx --env-file=.env scripts/migrate-turso-sip-columns.ts
```

### Reset portfolio (Turso or local)

Resets cash to **₹1,00,000**, clears open positions + pending orders, and schedules SIP **₹20,000 on the 5th IST** starting the **next** month:

```bash
npx tsx --env-file=.env scripts/reset-portfolio.ts
```

(Uses Turso when `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` are set; otherwise local SQLite.)

LLM / agent keys (optional): `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `LLM_MODEL`.

## npm scripts


| Script                       | Purpose                                   |
| ---------------------------- | ----------------------------------------- |
| `npm run dev`                | Next.js dev server                        |
| `npm run build` / `start`    | Production build / serve                  |
| `npm run scanner:sync`       | `uv sync` — install/update Python deps    |
| `npm run scanner`            | Start FastAPI scanner (no sync)           |
| `npm run autotrade`          | Server-side auto-trade loop               |
| `npm run seed`               | Seed DB                                   |
| `npm run db:migrate-turso`   | Apply SIP column migration to Turso       |
| `npm run db:reset-portfolio` | Reset portfolio to ₹1L (+ SIP next month) |
| `npm run pr:review`          | Quant/finance static PR review script     |
| `npm test`                   | Vitest                                    |


## Layout


| Path                                   | Role                               |
| -------------------------------------- | ---------------------------------- |
| `src/`                                 | Next.js app, APIs, UI              |
| `prisma/`                              | Schema + local SQLite / Turso      |
| `scanner/`                             | Python scanner & AI engines        |
| `pyproject.toml` / `uv.lock` / `.venv` | Scanner Python project (repo root) |
| `wheels/`                              | Local torch CPU wheel (gitignored) |
| `scripts/`                             | Import / maintenance scripts       |
| `tests/`                               | Vitest                             |


Local-only (gitignored): `docs/`, `migration/`, `.venv/`, `wheels/*.whl`.

## Troubleshooting


| Symptom                                               | Fix                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `'next' is not recognized`                            | Run `npm install` from `tradesim/`                                                         |
| `Cannot find module '.prisma/client/default'`         | `npx prisma generate`                                                                      |
| `better-sqlite3` / `node-gyp` / missing Visual Studio | Use **Node 22 LTS**, then reinstall (`rm -rf node_modules` → `npm install`)                |
| Forecast: 0 bars / yfinance “delisted”                | Ensure `yfinance==1.5.2` via `npm run scanner:sync`; scanner uses Yahoo chart API fallback |
| Forecast: torch not installed                         | Run `npm run scanner:sync` (pulls CPU torch from PyTorch index)                            |
| `EADDRINUSE` / port 8000 in use                       | Stop old scanner PID, or set `SCANNER_PORT`                                                |
| `uv sync` Python 3.11 resolve error for torch wheel   | Keep `requires-python = ">=3.12,<3.13"` and Python 3.12                                    |


## Scheduled jobs (GitHub Actions)

See `[.github/CRON-SCHEDULE.md](.github/CRON-SCHEDULE.md)` — **4 workflows**:

1. Kronos cache — 6:30 AM IST
2. Daily scan — 9:00 AM IST
3. Auto-trade — every **15 min**, 9:15–15:30 IST
4. Daily report — 4:00 PM IST

### PR review (quant / finance)

On every pull request, `[.github/workflows/pr-review.yml](.github/workflows/pr-review.yml)` runs **Claude Code Action** with a senior quant/finance review prompt (TradeSim portfolio guardrails + correctness checklist). It posts PR / inline comments.

**Secrets (same as other Actions):** `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` (fallback: `LLM_API_KEY`, `LLM_BASE_URL`).

Details: `[.github/PR-REVIEW.md](.github/PR-REVIEW.md)`.

Optional local static scan (no LLM):

```bash
npm run pr:review
npx tsx scripts/ci/pr-quant-review.ts --base origin/main
npx tsx scripts/ci/pr-quant-review.ts --all
```

Cursor Bugbot: local `.cursor/BUGBOT.md` (gitignored — keep under `.cursor/` on your machine). Comment `cursor review` / `bugbot run` on a PR if Bugbot is enabled.

## Notes

- Starting equity ₹1,00,000; monthly SIP ₹20,000 on the **5th (IST)**, starting the month after portfolio start/reset (capital, not P&L).
- Whole-share quantities only; max ₹25,000 allocation per trade; 30% cash reserve; up to 8 open positions (not forced).
- Cursor project rules live in local `.cursor/rules/` (gitignored).


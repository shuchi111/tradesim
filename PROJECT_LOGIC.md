# TradeSim — Architecture & Quant Logic Documentation

> A full-stack, AI-augmented **paper-trading simulator for the Indian (NSE) equity market**, combining classical technical-analysis strategies, a foundation-model forecaster, a multi-agent LLM "trading firm", a daily swing-trade scanner, and a disciplined risk engine — all backed by a shared Turso/SQLite database and driven by GitHub Actions cron jobs.
>
> **Live deployment:** [https://tradesim-dun.vercel.app/](https://tradesim-dun.vercel.app/)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture & Tech Stack](#2-architecture--tech-stack)
3. [Data Layer](#3-data-layer)
4. [Trading Engine (The Heart of the System)](#4-trading-engine-the-heart-of-the-system)
5. [Multi-Strategy Signal Engine](#5-multi-strategy-signal-engine)
6. [Risk Management System](#6-risk-management-system)
7. [ML Confidence Scoring](#7-ml-confidence-scoring)
8. [Backtest Engine](#8-backtest-engine)
9. [Performance Metrics](#9-performance-metrics)
10. [Python Scanner — "Tauric Research"](#10-python-scanner--tauric-research)
11. [Kronos AI Forecast Engine](#11-kronos-ai-forecast-engine)
12. [TradingAgents — 10-Agent LLM Firm](#12-tradingagents--10-agent-llm-firm)
13. [Market Regime Detection](#13-market-regime-detection)
14. [Automation & Cron Pipeline](#14-automation--cron-pipeline)
15. [Frontend & API Layer](#15-frontend--api-layer)
16. [Key Design Decisions & Quant Philosophy](#16-key-design-decisions--quant-philosophy)

---

## 1. System Overview

TradeSim simulates a **disciplined swing-trading desk** starting with **₹1,00,000** of virtual capital, with a **₹20,000 monthly SIP** (Systematic Investment Plan) injected on the 7th of each month. It is not a single strategy — it is a *trading platform* that combines multiple independent decision systems:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GITHUB ACTIONS (cron)                        │
│  06:30 IST  Kronos cache  │  09:00 IST  Daily scan  │  09:15–15:30  │
│  (foundation model)       │  (7-method screener)    │  Auto-trade    │
│  16:00 IST Daily report   │                         │  (every 15m)   │
└───────────────┬─────────────────────┬───────────────────┬───────────┘
                ▼                     ▼                   ▼
┌───────────────────────┐  ┌────────────────────┐  ┌──────────────────┐
│  Python FastAPI (8000)│  │  scanner/tauric.db │  │  TS auto-trade   │
│  Kronos + 7 methods + │──│  (SQLite, WAL)     │──│  runAutoTrade()  │
│  10-agent LLM firm    │  └─────────┬──────────┘  └────────┬─────────┘
└───────────────────────┘            │ sync to Turso        │
                                     ▼                      ▼
                          ┌──────────────────────────────────────┐
                          │      TURSO (libSQL) via Prisma 7     │
                          │  Account, Orders, Trades, Positions, │
                          │  Backtests, Reports, Forecasts, ...  │
                          └──────────────────┬───────────────────┘
                                             ▼
                          ┌──────────────────────────────────────┐
                          │   Next.js 16 (Vercel) — 12-tab SPA   │
                          │  Home · Chart · Strategy · Backtest  │
                          │  Scanner · Forecast · Confidence ... │
                          └──────────────────────────────────────┘
```

**Two independent signal pipelines feed one execution engine:**


| Pipeline                  | Language                           | Role                                                  | Frequency                           |
| ------------------------- | ---------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| **Multi-Strategy Engine** | TypeScript (`src/lib/strategy.ts`) | 5 strategies → consensus → live auto-trade + backtest | On demand (live) / daily (backtest) |
| **Tauric Scanner**        | Python (`scanner/`)                | 7-method NIFTY500 screen → AI scoring → daily picks   | Once daily (9:00 IST)               |


Both write to a shared Turso DB so the UI sees one coherent picture.

---

## 2. Architecture & Tech Stack

### Frontend

- **Next.js 16** (App Router) + **React 19**, deployed on **Vercel**
- **Tailwind CSS v4** (PostCSS-based, dark theme)
- **lightweight-charts v5** (TradingView's charting lib) for candlesticks, volume, equity curves, and Monte-Carlo forecast fans
- Single-page app with **12 tabs** (`src/app/page.tsx`)

### Backend (dual)

- **Next.js Route Handlers** (~25 API routes under `src/app/api/`) — trading, positions, metrics, backtest, reports
- **Python FastAPI** service (`scanner/main.py`, port 8000, `root_path=/scanner`) — proxied via `next.config.ts` rewrite `/scanner/* → :8000/`*

### Database

- **Prisma 7** ORM with dual adapter:
  - **Turso (libSQL)** when `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` are set (production/Vercel)
  - **better-sqlite3** local fallback (`prisma/tradesim.db`)
- The Python scanner keeps its **own SQLite DB** (`scanner/tauric.db`, WAL mode); CI scripts sync its results *into* Turso so both worlds share data.

### AI / ML

- **Kronos** foundation model (`NeoQuasar/Kronos-small`) — time-series forecasting via PyTorch (CPU)
- **TradingAgents** — 10+2 agent LLM "trading firm" (analyst/research/trader/risk teams)
- All LLM calls route through an **Anthropic-compatible gateway** (default `https://api.z.ai/api/anthropic`, model `glm-5.1`)

### Key Dependencies

```
Next.js 16 · React 19 · Prisma 7 · @prisma/adapter-libsql · better-sqlite3
lightweight-charts 5 · Tailwind v4 · vitest 4 · tsx 4

Python: FastAPI · uvicorn · yfinance 1.5.2 · pandas · numpy · httpx
        apscheduler · torch (CPU) · einops · huggingface_hub · safetensors
        tradingagents · kronos_model
```

---

## 3. Data Layer

### Prisma Schema (`prisma/schema.prisma`) — 18 models

The schema is the source of truth. Key models:


| Model                                            | Purpose                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Account**                                      | Singleton (id=1): balance, startingEquity (₹1L), SIP config (amount, day, eligibleFrom), totalDeposited, lastSipDate |
| **Position**                                     | Open holdings: entryPrice, quantity, peakPrice, troughPrice (for MFE/MAE), partialExitTaken flag                     |
| **Order**                                        | Pending limit orders (filled/cancelled)                                                                              |
| **Trade**                                        | Raw fill log (every buy/sell)                                                                                        |
| **CustomStrategyTrade**                          | Closed-trade analytics: pnl, pnlPct, entryReason, exitReason, maxFavorable (MFE), maxAdverse (MAE), holdDuration     |
| **TrailingStopEvent**                            | Audit log of every risk trigger (entry, stop_loss, trailing_stop, partial_profit, peak_update, …)                    |
| **Backtest / BacktestTrade**                     | Persisted backtest runs with equity curve + per-strategy stats                                                       |
| **DailyReport / Notification**                   | Daily P&L reports and in-app notifications                                                                           |
| **AutoTradeConfig**                              | Toggle + settings for the auto-trader                                                                                |
| **AgentAnalysis**                                | Persisted 10-agent LLM analyses                                                                                      |
| **ForecastCache**                                | Kronos forecasts synced from scanner DB                                                                              |
| **ScannerScan**                                  | Daily Tauric scan results synced from scanner DB                                                                     |
| **MarketSnapshot / RiskSnapshot / StrategyPerf** | Time-series portfolio health                                                                                         |


### The SIP Model (Capital Discipline)

A subtle but critical design decision — **SIP deposits are capital, not profit**:

```
startingEquity = ₹1,00,000  (never changes after reset)
sipAmountInr   = ₹20,000
sipDayOfMonth = 7            (the 7th of each IST month)
sipEligibleFrom = first instant of NEXT IST month after start/reset
```

- On reset, SIP does **not** start this month — only the *subsequent* month (`firstOfNextIstMonth()`). This prevents a fresh-start windfall.
- `processSipDeposit()` checks four conditions before depositing: day ≥ 7, past `eligibleFrom`, not already deposited this IST month.
- `totalDeposited` is tracked separately. P&L is always measured against **invested capital = startingEquity + totalDeposited**, so SIP inflows never masquerade as trading gains.
- IST handling uses `Intl.DateTimeFormat('en-Ca', { timeZone: 'Asia/Kolkata' })` — DST-proof since IST is fixed UTC+5:30.

---

## 4. Trading Engine (The Heart of the System)

**File:** `src/lib/trading.ts` (1,242 lines) — the execution core. All live trading and CI auto-trading funnels through here.

### 4.1 Order Processing

```
processMarketOrder / processLimitOrder  →  processFill()  →  Trade record
```

`**processFill()**` is the single source of truth for every execution. It enforces:


| Rule                     | Implementation                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Whole shares only**    | `requireWholeShares()` — rejects fractional buys; allows exact full-close of legacy fractional positions (tolerance 1e-9) |
| **Cash reserve**         | Must keep `startingEquity × 30% = ₹30,000` in wallet after any buy                                                        |
| **Insufficient balance** | Rejects if `cost > balance`                                                                                               |
| **Position averaging**   | On re-buy: weighted-average entry price = `(oldEntry×oldQty + price×qty) / totalQty`                                      |
| **Sell penalty**         | Flat **₹150 per sell**, permanently lost (simulates brokerage + slippage friction)                                        |
| **MFE/MAE tracking**     | Updates `peakPrice` / `troughPrice` on every fill and every auto-trade tick                                               |


### 4.2 Position Sizing (`sizePosition`)

Confidence-tiered allocation, **capped at ₹25,000 per trade** to prevent concentration:

```typescript
allocationPct = confidence ≥ 90 ? 0.08
              : confidence ≥ 80 ? 0.06
              :                    0.04

capped = min(totalEquity × allocationPct, investableCash, ₹25,000)
qty = floor(capped / price)   // whole shares only
```

This means a high-confidence trade still can't exceed ₹25k, enforcing diversification even when conviction is high.

### 4.3 The Auto-Trade Loop (`runAutoTrade`)

This is the master routine, run by the CI cron every 15 minutes during NSE hours:

```
0a. processSipDeposit()           → inject monthly SIP if due
0b. getRiskStatus()               → compute portfolio risk + circuit breaker
 1. RISK-MANAGE EXISTING POSITIONS (always runs first):
      for each open position:
        - update peak/trough (MFE/MAE)
        - log peak_update event on new high watermark (≥5%)
        - generate fresh multi-strategy signal for held symbol
        - shouldCloseForRisk() → partial close / full close / hold
        - closePositionAtMarket() with full exit context
 2. CIRCUIT BREAKER check → if active, stop (no new buys)
 3. MAX POSITIONS check (≤ 8 open)
 4. SCAN ALL INSTRUMENTS for new BUY signals:
      - skip already-held, skip non-INR / index
      - generateMultiStrategySignal() → BUY?
      - threshold: confidence ≥ 70 if ≥2 strategies agree, else ≥ 80
      - REJECT overbought (RSI > 70) — buying at RSI>70 is a losing trade
      - calculateConfidenceScore() → fetch full AI composite score
      - use AI confidence if available, else strategy confidence
 5. SORT candidates by confidence (desc) → buy top N (slots available)
 6. EXECUTE with sizePosition() + whole shares + ₹25k cap
```

**Key entry-quality filters (the "edge"):**

- Multi-strategy agreement lowers the confidence bar (70 vs 80) — consensus itself is signal.
- RSI > 70 hard rejection — never chase overbought entries.
- AI confidence score (when available) overrides strategy confidence for ranking.

---

## 5. Multi-Strategy Signal Engine

**File:** `src/lib/strategy.ts` (802 lines)

### 5.1 Indicator Bundle (computed once, shared)

`computeIndicators()` builds a single `IndicatorBundle` from OHLCV:


| Indicator       | Notes                                                                 |
| --------------- | --------------------------------------------------------------------- |
| SMA 5/20/50     | Simple moving averages (prev-bar values for crossover detection)      |
| EMA 9/21        | Exponential (array form for full series + prev values)                |
| RSI 14          | **Wilder's smoothing** (seed avg then `avgGain = (avg×13 + gain)/14`) |
| MACD            | 12/26/9 — EMA fast − slow, signal = EMA(9) of MACD line               |
| Bollinger Bands | 20-period, 2σ — upper/mid/lower/bandwidth/%B                          |
| ATR 14          | Wilder-smoothed True Range for volatility-based stops                 |
| 20-day high     | `prevHigh20` excludes today → detects *today's* breakout              |


Requires ≥ 26 bars (MACD slow period); returns `null` otherwise.

### 5.2 The Five Strategies

Each strategy returns `{ name, signal: BUY|SELL|HOLD, confidence, reason }` via a **weighted score** system. Positive score → bullish, negative → bearish.

#### Strategy 1: Multi-Indicator Confluence

A classic "everything agrees" approach. Weighted scoring:

- **SMA crossover (±2):** Golden/death cross SMA(5/20); +1 if SMA5>SMA20 (bullish alignment)
- **RSI (±2):** <30 oversold buy, >70 overbought sell; ±1 in transition zones
- **MACD (±2):** Bullish/bearish crossover (histogram sign + line vs signal)
- **Bollinger (±1):** Lower band = mean-reversion buy; upper band = overextended
- **Volume (±0.5):** High volume (1.5× avg) *confirms* the prevailing direction
- Signal if `|score| ≥ 1.5`; confidence = `min(99, |score|×12 + 20)`

#### Strategy 2: Momentum Breakout

Donchian-style channel breakout:

- **20-day high breakout (+3):** `close > prevHigh20`
- **Volume surge (+2):** > 1.5× avg 20-day volume
- **RSI in momentum zone (±1):** 40–70 is healthy momentum; >75 is overbought
- **Trend alignment (±1):** SMA5>SMA20 confirms; counter-trend breakout penalized
- Signal if `|score| ≥ 3`

#### Strategy 3: Mean Reversion (Oversold Bounce)

Catches oversold bounces — but **never catches falling knives**:

- **RSI deeply oversold (+3/+2/+1):** <30, <35, <40 tiers
- **Bollinger touch (±2):** Lower band buy / upper band sell
- **RSI turning up (+2):** `RSI > prevRSI` while still <45 — momentum shifting
- **SMA50 filter (±2):** Only buy the bounce if price is *above* SMA50 (structural support). Below SMA50 = downtrend, risky.
- Signal if `|score| ≥ 3`

#### Strategy 4: EMA Crossover Trend

- **EMA(9/21) crossover (±3):** Fresh bull/bear cross
- **SMA50 trend filter (±2/±1):** Price above/below SMA50 confirms long-term trend
- **MACD histogram confirmation (±2):** Momentum must agree with direction
- Signal if `|score| ≥ 3`

#### Strategy 5: Kronos AI (async, cached)

Reads the pre-computed daily forecast from the scanner cache (see §11):

- `direction=bullish` + `upside_probability > 55%` → BUY
- `direction=bearish` + `upside_probability < 45%` → SELL
- Confidence = `0.5 × confidence_pct + 0.5 × |upside_probability − 50| × 2`

### 5.3 Consensus Aggregation (`aggregateStrategies`)

This is where the strategies combine into a single decision — **the core alpha of the system**:

```
2+ strategies BUY  → strong BUY, confidence = avg(confs) × (1 + 0.1 × (count−1))
1 strategy BUY     → BUY at base confidence (if 0 sells)
2+ strategies SELL → strong SELL (mirror logic)
1 strategy SELL    → SELL at base confidence (if 0 buys)
otherwise          → HOLD (neutral or conflicting)
```

The **+10% confidence boost per additional agreeing strategy** rewards genuine confluence — three strategies agreeing is meaningfully stronger than two.

### 5.4 ATR-Based Risk Levels

When a BUY/SELL signal fires and ATR > 0:

```
stopLoss   = price − ATR × 1.5   (long)  /  + ATR × 1.5 (short)
takeProfit = price + ATR × 3     (long)  /  − ATR × 3 (short)
riskReward = 2.0  (fixed 1:2 ratio)
```

This ties exit levels to *each stock's own volatility* rather than fixed percentages.

---

## 6. Risk Management System

**File:** `src/lib/trading.ts` → `shouldCloseForRisk()` + `getRiskStatus()`

This is deliberately **defensive and layered** — seven exit conditions evaluated in strict priority order:

### 6.1 Exit Hierarchy (priority order)


| #   | Trigger            | Condition                         | Type                        |
| --- | ------------------ | --------------------------------- | --------------------------- |
| 1   | **Hard stop-loss** | `pnlPct ≤ −7%`                    | `stop_loss`                 |
| 2   | **Partial profit** | `pnlPct ≥ +5%` & no partial taken | `partial_profit` (sell 50%) |
| 3   | **Breakeven stop** | partial taken & `pnlPct ≤ 0%`     | `breakeven_exit`            |
| 4   | **Take-profit**    | `pnlPct ≥ +15%`                   | `take_profit`               |
| 5   | **Trailing stop**  | peak ≥ +7% & current < peak × 0.4 | `trailing_stop`             |
| 6   | **Time exit**      | held ≥ 10 days & `                | pnlPct                      |
| 7   | **Signal sell**    | strategy consensus = SELL         | `signal_sell`               |


**Design rationale for each:**

- **−7% stop** (widened from −5%): survives normal NSE volatility without noise-triggered exits.
- **+5% partial**: bank half the gain, move stop to breakeven — "free ride" on the remainder.
- **+15% take-profit** (raised from +10%): lets winners run further.
- **Trailing stop** (60% protection): once a position peaks at +7%, exit if it gives back more than 40% of peak gain. Formula: `exit if pnlPct < peakGainPct × 0.4`.
- **Time exit**: 10 stagnant days with <3% move → free the capital. Opportunity cost matters.

### 6.2 Circuit Breaker (`getRiskStatus`)

Portfolio-level kill switch for **new buys** (existing positions are still risk-managed):

```
circuitBreakerActive = drawdownPct > 6%  OR  dailyPnl < −(equity × 2.5%)
```

When active: no new entries, but stop-losses/trailing-stops keep running. This prevents compounding losses on bad days.

### 6.3 Full Audit Trail

Every risk trigger writes two records:

1. `**TrailingStopEvent**` — full event with entry/current/peak prices, pnl%, reason, metadata
2. `**Notification**` — user-facing message (severity: danger for stop_loss, success for take_profit/trailing_stop)

Plus `peak_update` events on new high watermarks (≥5% gain) — so you can see the trailing stop ratcheting up in real time.

### 6.4 Closed-Trade Analytics (MFE/MAE)

Every closed `CustomStrategyTrade` records:

- `maxFavorable` (MFE): max gain from entry, derived from tracked `peakPrice`
- `maxAdverse` (MAE): max drawdown from entry, derived from `troughPrice`
- `holdDuration`: minutes held

This enables post-hoc analysis like *"this trade closed at +3% but peaked at +9% — the trailing stop gave back too much."*

---

## 7. ML Confidence Scoring

**Files:** `src/lib/ml/confidence.ts` + `src/lib/ml/features.ts`

### 7.1 Composite Score (5 weighted components)

The "AI Score" that the Confidence tab and auto-trader use:

```
Confidence = Strategy Agreement × 0.35   (5-strategy consensus)
           + ML Prediction        × 0.25   (heuristic logistic model)
           + Kronos AI            × 0.15   (foundation-model forecast)
           + Market Regime        × 0.15   (trend + volatility regime)
           + Historical Win Rate  × 0.10   (strategy backtest proxy)
```

**Recommendation tiers:** ≥80 STRONG BUY · ≥65 BUY · ≥45 HOLD · <45 AVOID

### 7.2 Feature Engineering Pipeline (`extractFeatures`)

Extracts a **25-dimension feature vector** from 3 months of daily data:

- **Price-based:** RSI14 (+prev), MACD (line/signal/hist), BB %B & bandwidth, distances to SMA5/20/50, EMA9 vs EMA21
- **Volume:** current/avg ratio, 5-day volume trend
- **Volatility:** ATR% of price, 20-day annualized realized vol
- **Momentum:** 5d/10d/20d returns, RSI delta
- **Trend:** composite trendScore (−1 to +1), higher-highs count
- **Regime:** volatilityRegime (0/1/2), trendRegime (−1/0/+1)

### 7.3 Heuristic ML Prediction (`heuristicPrediction`)

A **logistic-regression-style scorer** (placeholder while a real trained model is built):

1. Accumulate weighted contributions from: RSI zone, trend alignment, MACD, volume, momentum, BB position
2. Convert to probability via **sigmoid**: `P(success) = 1 / (1 + e^(−score/15)) × 100`

Each factor returns a `{name, contribution, direction}` row so the UI can show *why* the model scored it that way — full explainability.

### 7.4 Kronos Factor Decomposition

When a Kronos forecast exists, the confidence engine decomposes it into 4 sub-factors:

- **Direction** contribution: `confidence_pct × 0.15` (0 if neutral)
- **Predicted move**: `|change%| × 2`, capped at 10
- **Model confidence**: `(confidence_pct − 50) × 0.2` when >50%
- **Volatility outlook**: Amplified (>130%) = bearish +5; Suppressed (<100%) = bullish +3

---

## 8. Backtest Engine

**File:** `src/lib/backtest.ts` (752 lines)

### 8.1 Design Principle: **No Look-Ahead Bias**

The backtest replays history through the **exact same strategies and risk rules** as live trading. Critical anti-bias measures:

1. **Kronos is EXCLUDED** from backtesting — it's a forward-looking AI model; using it on historical data would be look-ahead bias.
2. `evaluateSignal(klines, barIndex)` uses **only bars up to and including `barIndex`** — slices the window to `klines[barIndex−119 … barIndex]`.
3. **120-day lookback cushion** fetched before `startDate` so SMA50/MACD are warm at the start.
4. Entry thresholds mirror live exactly: confidence ≥ 70 (if ≥2 strategies) or ≥ 80; RSI > 70 rejection.

### 8.2 Walk-Forward Simulation (`runBacktest`)

For each trading day in the period:

```
4a. Gather all symbols' closing bars for this date
4b. RISK-MANAGE existing positions FIRST (stop-loss, partial, trailing, time, signal)
4c. Compute current equity = cash + Σ(position qty × close)
4d. Circuit breaker check (drawdown > 6% OR daily loss > 2.5% equity)
4e. If breaker off & slots open: scan for BUY signals, sort by confidence, fill slots
4f. Record equity point
```

At end: close any remaining open positions at last price (`exitReason: backtest_end`).

### 8.3 Output Metrics

Per backtest run: starting/final equity, total return %, trade count, win rate, **Sharpe ratio** (annualized, √252), **max drawdown %**, **profit factor**, avg win/loss %, avg hold days, full **equity curve**, **per-strategy stats** (trades/wins/winRate/avgPnlPct/totalPnl), and every individual trade with MFE/MAE.

The per-strategy breakdown is key — it tells you *which strategy carries the edge*.

---

## 9. Performance Metrics

**File:** `src/lib/metrics.ts`


| Metric            | Formula / Method                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Expectancy**    | `winRate × avgWin − lossRate × avgLoss` (per-trade expected value)                                                       |
| **XIRR**          | Newton-Raphson solver on XNPV: cash flows = {−startingEquity at day 0, −SIP deposits at each date, +currentEquity today} |
| **CAGR**          | `(end/start)^(1/years) − 1` — only computed if ≥30 days of history (avoids absurd annualization)                         |
| **Sharpe**        | `(meanDailyReturn / stdDev) × √252`, risk-free = 0                                                                       |
| **Max Drawdown**  | Max peak-to-trough decline as % from equity curve                                                                        |
| **Profit Factor** | `grossProfit / grossLoss` (>1 profitable, >1.5 good, >2 excellent)                                                       |


### SIP-Correct Accounting (critical detail)

The equity curve merges **trade closings AND deposits** into one chronological stream, so SIP inflows don't inflate the curve. `investedCapital = startingEquity + totalDeposited` is the baseline; `totalPnl = currentEquity − investedCapital`. This is why SIP never shows as profit.

---

## 10. Python Scanner — "Tauric Research"

**Directory:** `scanner/` — a FastAPI service providing the daily swing-trade screener.

### 10.1 The 7-Method Screening Pipeline

`**scanner_engine.py` → `run_full_scan()`:**

```
1. get_market_context()          → Nifty, VIX, FII/DII, regime
2. get_sector_returns()          → 5-day returns for 12 sector indices
3. Scan top 60 NIFTY500 stocks (batches of 10):
     for each stock:
       fetch 60+ days OHLCV
       run_all_methods() → 6 rule-based methods
       if ≥1 method triggered → candidate
4. AI scoring (M7) on each candidate (REQUIRED — raises if no LLM key)
5. Sort by AI score → top 5 picks (MAX_PICKS)
6. save_scan_result() to scanner/tauric.db
```

### 10.2 The 6 Rule-Based Methods (`scanner/methods.py`)


| Method                     | Logic                                                                             | Trigger            |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------ |
| **M1 — Breakout + Volume** | Close > 52W high (prev-bar shifted) AND volume > 1.5× 20D avg                     | Momentum breakout  |
| **M2 — Supertrend + MACD** | Supertrend(7,3) bullish AND MACD line > signal AND fresh crossover in last 5 bars | Trend continuation |
| **M3 — RSI Reversal**      | RSI crossed from <30 to >35 with a bullish candle (close>open)                    | Oversold bounce    |
| **M4 — EMA Crossover**     | EMA20 crossed above EMA50 today (was ≤ yesterday) with above-avg volume           | Trend initiation   |
| **M5 — Sector Momentum**   | Stock's sector is in the **top-2** by 5-day return (via symbol→sector map)        | Sector rotation    |
| **M6 — Bullish Engulfing** | Today's body engulfs yesterday's, bullish, near EMA50 support (within 3%)         | Reversal pattern   |


### 10.3 Pure-Pandas Indicators (`scanner/indicators.py`)

No `pandas-ta` dependency — all indicators hand-implemented:

- SMA/EMA (pandas rolling/ewm)
- RSI (Wilder's, via `ewm(alpha=1/period)`)
- MACD (EMA fast − slow, signal = EMA(9) of MACD)
- ATR (True Range → Wilder smoothing)
- **Supertrend** (custom implementation with band adjustment logic)
- Bollinger Bands, rolling_max

### 10.4 M7 — AI Composite Scoring (`scanner/ai_scorer.py`)

Every candidate that passes ≥1 rule-based method is scored by the LLM:

- **System prompt** enforces JSON-only output with schema: `{score (1-10), confidence, entry_low/high, stop_loss, target_1/2, hold_days, methods_triggered, tags, risk_tag, key_risk}`
- **Scoring rules:** 8-10 needs ≥3 methods + strong fundamentals; 6-7 needs 2 methods + earnings/FII; <6 is weak.
- **Auto-tags:** `OVEREXTENDED` if RSI > 75; `FAKEOUT` risk if M1 breakout with low volume.
- **Defensive parsing:** strips markdown fences, coerces numeric fields (LLMs return strings), fills missing targets from entry (target_1 = +4%, target_2 = +8%, SL = −4%).
- **Hard requirement:** if candidates exist but no LLM key, the scan **raises** rather than returning unranked picks.

---

## 11. Kronos AI Forecast Engine

**Files:** `scanner/kronos_engine.py` + `scanner/kronos_cache.py`

### 11.1 Foundation Model Forecasting

Uses `**NeoQuasar/Kronos-small`** (a time-series foundation model, *not* an LLM) for OHLCV prediction:

- **Lazy-loaded** + cached as module global (first call loads model in a thread; ~18s)
- **Probabilistic sampling:** generates `sample_count` independent forecast paths (each `predict()` call with `sample_count=1`, `top_p=0.9`, `T=1.0`)
- Computes **p5/p10/p25/p50(median)/p75/p90/p95** confidence bands from the stacked paths
- Returns: historical candles + median forecast candles + percentile bands + individual sample paths (for the chart's Monte-Carlo fan)

### 11.2 Probabilistic Metrics (derived from the path ensemble)


| Metric                       | Meaning                                                   |
| ---------------------------- | --------------------------------------------------------- |
| **predicted_change_pct**     | (median final close − current) / current × 100            |
| **direction**                | bullish if >+1%, bearish if <−1%, else neutral            |
| **upside_probability**       | % of paths ending above current price                     |
| **volatility_amplification** | % of paths whose return-std exceeds recent historical vol |
| **confidence_pct**           | % of paths agreeing on the direction                      |


### 11.3 Caching Strategy (`kronos_cache.py`)

Since each forecast takes ~8-15s of CPU, forecasts are **pre-computed at 6:30 AM IST** for 15 key symbols (Nifty index + 14 large caps), at both 5-day and 10-day horizons:

- Stored in `scanner/tauric.db` (`kronos_forecasts` table, **WAL mode** for concurrent reads)
- **36-hour TTL** — stale forecasts are ignored
- Synced to Turso by CI so the Next.js frontend reads them instantly
- The TS strategy engine reads via `resolveKronosSummary()` — **never blocks** (returns null → HOLD on failure)

---

## 12. TradingAgents — 10-Agent LLM Firm

**File:** `scanner/agent_engine.py`

Wraps the **TauricResearch/TradingAgents** framework — a multi-agent debate system modeling a real trading desk:

```
ANALYST TEAM (4 agents):
  📊 Market Analyst     — technicals (MACD, RSI, MAs, S/R, volume)
  💬 Sentiment Analyst  — social/retail sentiment
  📰 News Analyst       — macro news, earnings, geopolitics
  📋 Fundamentals Analyst — P/E, growth, margins, debt, insider activity
        ↓ (reports feed into debate)
RESEARCH TEAM (3 agents):
  🐂 Bull Researcher    — builds bullish thesis, argues BUY
  🐻 Bear Researcher    — builds bearish thesis, argues SELL
  ⚖️ Research Manager   — judges the debate → recommendation
        ↓
TRADER (1 agent):
  🎯 Trader             — composes all reports → trading decision + sizing
        ↓
RISK MANAGEMENT (4 agents):
  🔥 Aggressive         — argues for max size / higher risk
  🧮 Neutral            — balanced perspective
  🛡️ Conservative       — argues for capital preservation
  🏛️ Risk Manager (PM)  — FINAL decision: approve/reject, size, targets, SL
```

- Runs in a **background thread** (takes 3-8 minutes); status polled via task_id
- Output: 12 individual agent reports + final `{signal, confidence, size_fraction, target_price, stop_loss}`
- Uses the same z.ai GLM gateway (monkey-patches out `reasoning_effort` param not supported by GLM)
- Results persisted to `scanner/agent_results/` on disk + Turso `AgentAnalysis` table

---

## 13. Market Regime Detection

**File:** `scanner/market_context.py` → `determine_regime()`

A simple, robust three-state classifier used by both the scanner and the ML regime score:

```
BEARISH  if  VIX > 20  OR  Nifty < SMA20 × 0.97
BULLISH  if  VIX < 15  AND  Nifty > SMA20  AND  FII net > 0
CAUTION  otherwise
```

**Data sources:** Nifty 50 (`^NSEI`), India VIX (`^INDIAVIX`), FII/DII flows (NSE API, best-effort with safe fallback to 0). All fetched in parallel via `asyncio.gather`.

This regime feeds into:

- The scanner's AI prompt ("Market regime today: BULLISH")
- The ML confidence regime score (uptrend +20, downtrend −20, low vol +10, high vol −15)

---

## 14. Automation & Cron Pipeline

**Directory:** `.github/workflows/` + `scripts/ci/`

Four scheduled workflows keep the system alive without a always-on server:


| Workflow (IST)                                   | What it runs                                                         | Effect                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `**kronos-cache.yml`** — 06:30 daily             | `scheduler.run_daily_kronos_cache` + `sync-kronos-cache-to-turso.ts` | Pre-computes 30 Kronos forecasts → Turso, before market open         |
| `**daily-scan.yml`** — 09:00 daily               | `scanner/ci_run_daily_scan.py` + `sync-scan-to-turso.ts`             | Runs 7-method scan → AI scores → syncs top picks to Turso            |
| `**auto-trade.yml**` — every 15 min, 09:15–15:30 | `scripts/ci/run-autotrade-once.ts`                                   | One `runAutoTrade()` cycle (only if within NSE session via UTC math) |
| `**daily-report.yml**` — 16:00 daily             | `scripts/ci/run-daily-report-once.ts`                                | Generates daily report + notification                                |


A fifth workflow, `**pr-review.yml**`, runs an LLM-based **quant/finance code review** on every PR (via `scripts/ci/pr-quant-review.ts` — static checks for: whole shares, cash reserve, ₹25k cap, SIP≠P&L, sell penalty, look-ahead bias).

### The "Two-DB Sync" Pattern

Because the Python scanner uses its own SQLite (`tauric.db`) while Vercel uses Turso, CI scripts bridge them:

- `sync-scan-to-turso.ts` — reads latest scan from tauric.db → writes `ScannerScan` to Turso
- `sync-kronos-cache-to-turso.ts` — reads forecasts from tauric.db → writes `ForecastCache` to Turso
- Both push a `Notification` so the UI auto-refreshes (the `NotificationBell` polls and bumps a refresh signal)

### NSE Session Detection (UTC math)

`isNseSessionUtc()`: excludes weekends; NSE 09:15–15:30 IST = **03:45–10:00 UTC**. The 15-minute auto-trade cron fires outside these bounds harmlessly (logs "skipping").

---

## 15. Frontend & API Layer

### 15.1 The 12 Tabs


| Tab                    | Component              | Purpose                                                     |
| ---------------------- | ---------------------- | ----------------------------------------------------------- |
| **Home**               | `HomeTab`              | Metrics dashboard + trading panel                           |
| **Chart**              | `ChartTab`             | Candlestick + volume (lightweight-charts) + trading panel   |
| **Strategy**           | `StrategyTab`          | 5-strategy signals table + auto-trade toggle + risk display |
| **Backtest**           | `BacktestTab`          | Run/view backtests with equity-curve area chart             |
| **Holdings**           | `HoldingsTab`          | Open positions with live P&L + close button                 |
| **Wallet**             | `WalletTab`            | Balance + SIP details                                       |
| **Trade Intelligence** | `TradeIntelligenceTab` | Exit/entry analytics, MFE/MAE, trailing-stop tracker        |
| **Reports**            | `ReportsTab`           | Daily report browser with full breakdown                    |
| **Confidence**         | `ConfidenceTab`        | AI Score — scan all symbols, ranked                         |
| **Health**             | `HealthTab`            | Portfolio risk: drawdown, circuit breaker, metrics          |
| **Scanner**            | `ScannerTab`           | Tauric 7-method picks + 10-agent panel + performance        |
| **Forecast**           | `ForecastTab`          | Kronos candles + probabilistic Monte-Carlo fan (5d/10d/24h) |


### 15.2 API Routes (~25 Route Handlers)

All under `src/app/api/`:

- **Trading:** `account`, `orders`, `positions`, `positions/close`, `trades`, `trades/closed`, `trades/intelligence`, `trailing-stops`, `ticker/[symbol]`
- **Strategy:** `strategy`, `strategy/autotrade`, `strategy/autotrade/status`
- **Analytics:** `metrics`, `risk`, `backtest`, `reports`, `confidence/[symbol]`
- **Scanner/AI (proxy to Python):** `agents`, `agents/analyze`, `agents/status/[taskId]`, `agents/history`, `agents/cached`, `scanner/latest`, `forecast/cached/[symbol]`
- **System:** `notifications`

### 15.3 Real-Time Updates

- `Header` polls live ticker price for the selected symbol
- `NotificationBell` polls notifications; on new cron-job notifications, triggers a global refresh signal
- `ScannerTab` and `BacktestTab` poll for fresh results (cron-synced data appears without manual refresh)

### 15.4 Currency Formatting (`src/lib/currency.tsx`)

INR-native with Indian compact notation (Lakh/Crore) via `CurrencyProvider` context — `₹1,50,000` not `₹150,000`. `fmtPnl()` handles +/- sign and color semantics.

---

## 16. Key Design Decisions & Quant Philosophy

### 16.1 Capital Discipline Over Returns

- ₹1L start, ₹20k/month SIP, **30% cash reserve always**, ₹25k max per trade, max 8 positions
- SIP is *capital*, never *profit* — every metric (P&L, CAGR, XIRR) measures against `startingEquity + totalDeposited`
- ₹150 flat sell penalty simulates real friction — discourages over-trading

### 16.2 Confluence > Single Signal

- Five *independent* strategies (trend, momentum, mean-reversion, crossover, AI)
- **2+ must agree** for a strong signal; +10% confidence boost per additional agreeing strategy
- No strategy alone can trigger a trade at high confidence

### 16.3 Defense First

- 7-layer exit hierarchy (stop → partial → breakeven → TP → trailing → time → signal)
- Circuit breaker halts new buys at 6% drawdown or 2.5% daily loss
- RSI > 70 entries **hard rejected** — never chase overbought
- Partial profit at +5% banks gains, moves stop to breakeven

### 16.4 Volatility-Adaptive Risk

- Stop-loss and take-profit use **ATR multiples** (1.5× SL, 3× TP), not fixed %
- Each stock's exits scale with its own volatility

### 16.5 No Look-Ahead Bias (backtest integrity)

- Backtest uses identical strategy + risk code paths
- Kronos excluded from backtest (forward-looking)
- Indicator windows sliced to exclude future bars
- 120-day lookback cushion for warm indicators

### 16.6 Explainability Everywhere

- Every trade records entry/exit reason + strategy detail + AI components
- ML confidence decomposed into named factors with contributions
- Full audit trail: `TrailingStopEvent` for every risk trigger, peak updates, entries, exits
- MFE/MAE on every closed trade

### 16.7 Two Complementary AI Systems

- **Kronos** (foundation model): *statistical* price distribution — gives probabilistic bands, upside %, volatility outlook
- **TradingAgents** (LLM firm): *reasoning-based* debate — fundamentals, news, sentiment synthesized by 12 debating agents
- Neither makes the final call alone — they *inform* the strategy engine and confidence score

### 16.8 Operational Resilience

- All AI calls **fail soft** (null → HOLD, never crash)
- Scanner DB sync is best-effort with safe fallbacks
- NSE session detection prevents off-hours trading
- GitHub Actions cron = zero always-on-server cost

---

## Appendix: File Map (by function)


| Concern                     | Files                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| **Trading engine**          | `src/lib/trading.ts`                                                                               |
| **Strategies + indicators** | `src/lib/strategy.ts`                                                                              |
| **Risk management**         | `src/lib/trading.ts` (`shouldCloseForRisk`, `getRiskStatus`)                                       |
| **Backtest**                | `src/lib/backtest.ts`                                                                              |
| **ML confidence**           | `src/lib/ml/confidence.ts`, `src/lib/ml/features.ts`                                               |
| **Metrics**                 | `src/lib/metrics.ts`                                                                               |
| **Scanner (Python)**        | `scanner/scanner_engine.py`, `scanner/methods.py`, `scanner/indicators.py`, `scanner/ai_scorer.py` |
| **Kronos forecast**         | `scanner/kronos_engine.py`, `scanner/kronos_cache.py`                                              |
| **Agent firm**              | `scanner/agent_engine.py`                                                                          |
| **Market context**          | `scanner/market_context.py`                                                                        |
| **DB schema**               | `prisma/schema.prisma`, `scanner/database.py`                                                      |
| **Cron / CI**               | `.github/workflows/`*, `scripts/ci/`*                                                              |
| **Frontend**                | `src/app/page.tsx`, `src/components/tabs/`*, `src/components/scanner/`*                            |
| **API routes**              | `src/app/api/**/route.ts`                                                                          |
| **Data fetching**           | `src/lib/market.ts`, `scanner/yahoo_data.py`                                                       |
| **Types**                   | `src/types/index.ts`                                                                               |


---

*Documentation generated from a full code review of the TradeSim repository. Every logic described above is implemented in the referenced source files.*
/**
 * Backtest Engine
 * 
 * Replays historical daily OHLCV data through the EXACT SAME strategies
 * and risk-management rules that live auto-trading uses. This produces
 * real win/loss data per strategy and per stock, so confidence scoring
 * can use historical performance instead of proxy estimates.
 */

import { prisma } from './prisma'
import { getKlines } from './market'
import {
  computeIndicators,
  strategyConfluence,
  strategyMomentumBreakout,
  strategyMeanReversion,
  strategyEmaCrossover,
  aggregateStrategies,
  type IndicatorBundle,
  type IndividualStrategyResult,
  type SignalDirection,
} from './strategy'

// ─── Constants (mirror trading.ts) ────────────────────────────────
const STARTING_CAPITAL = 100_000
const MAX_POSITIONS = 8
const CASH_RESERVE_PCT = 0.30
const STOP_LOSS_PCT = -7
const TAKE_PROFIT_PCT = 15
const PARTIAL_PROFIT_PCT = 5
const TRAILING_TRIGGER_PCT = 7
const TRAILING_PROTECT_FRAC = 0.4 // exit if current gain drops below 40% of peak (gives back 60%)
const TIME_EXIT_DAYS = 10
const TIME_EXIT_MIN_PCT = 3
const CIRCUIT_BREAKER_DRAWDOWN_PCT = 6
const CIRCUIT_BREAKER_DAILY_LOSS_PCT = 2.5 // % of total equity

// ─── Types ────────────────────────────────────────────────────────

export interface BacktestKline {
  date: string // ISO yyyy-mm-dd
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface SimPosition {
  symbol: string
  entryPrice: number
  quantity: number
  entryDate: string
  peakPrice: number
  troughPrice: number
  partialExitTaken: boolean
  strategy: string
  entryReason: string
}

interface SimTrade {
  symbol: string
  side: string
  entryDate: string
  exitDate: string | null
  entryPrice: number
  exitPrice: number | null
  quantity: number
  pnl: number | null
  pnlPct: number | null
  exitReason: string | null
  entryReason: string
  strategy: string
  maxFavorable: number | null
  maxAdverse: number | null
}

export interface BacktestMetrics {
  startingCapital: number
  finalEquity: number
  totalReturnPct: number
  totalTrades: number
  winRate: number
  sharpeRatio: number | null
  maxDrawdownPct: number
  profitFactor: number
  avgWinPct: number
  avgLossPct: number
  avgHoldDays: number
  equityCurve: { date: string; equity: number }[]
  strategyStats: Record<string, {
    trades: number
    wins: number
    losses: number
    winRate: number
    avgPnlPct: number
    totalPnl: number
  }>
  trades: SimTrade[]
}

export interface BacktestConfig {
  symbols: string[]
  startDate: string // ISO
  endDate: string   // ISO
  startingCapital?: number
  name?: string
}

// ─── Data fetching ────────────────────────────────────────────────

/**
 * Fetch historical daily klines for a symbol covering the full backtest
 * period PLUS enough lookback data (60 trading days) for indicators.
 */
async function fetchHistoricalKlines(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<BacktestKline[]> {
  // We need ~60 trading days before startDate for indicators (SMA50 etc.)
  // Yahoo 'period1/period2' API returns everything in range.
  const start = new Date(startDate)
  const lookbackStart = new Date(start)
  lookbackStart.setDate(lookbackStart.getDate() - 120) // ~85 trading days cushion

  const period1 = Math.floor(lookbackStart.getTime() / 1000)
  const period2 = Math.floor(new Date(endDate).getTime() / 1000)

  const yahooSymbol = symbol === 'NIFTY50' ? '%5ENSEI' : encodeURIComponent(symbol)

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}` +
    `?period1=${period1}&period2=${period2}&interval=1d`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`Yahoo API returned ${res.status} for ${symbol}`)

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  if (!result) throw new Error(`No data for ${symbol}`)

  const timestamps: number[] = result.timestamp || []
  const quote = result.indicators?.quote?.[0]
  if (!quote) throw new Error(`No OHLCV for ${symbol}`)

  const klines: BacktestKline[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i]
    const h = quote.high?.[i]
    const l = quote.low?.[i]
    const c = quote.close?.[i]
    const v = quote.volume?.[i]
    if (o == null || h == null || l == null || c == null) continue

    klines.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v ?? 0,
    })
  }

  return klines
}

// ─── Signal generation for a single day ──────────────────────────

/**
 * Evaluate the 4 technical strategies using ONLY data up to (and including)
 * the given bar index. Returns a consensus signal identical to what live
 * trading would see.
 * 
 * Kronos is excluded from backtesting because it's a forward-looking AI
 * model — using it on historical data would be look-ahead bias.
 */
function evaluateSignal(
  klines: BacktestKline[],
  barIndex: number
): { signal: SignalDirection; confidence: number; strategies: IndividualStrategyResult[]; reason: string } {
  // Use last N bars up to barIndex for indicator computation
  const lookback = Math.min(barIndex + 1, 120)
  const window = klines.slice(barIndex - lookback + 1, barIndex + 1)

  const ind = computeIndicators(window)
  if (!ind) {
    return { signal: 'HOLD', confidence: 0, strategies: [], reason: 'Insufficient data' }
  }

  const strategyResults: IndividualStrategyResult[] = [
    strategyConfluence(ind),
    strategyMomentumBreakout(ind),
    strategyMeanReversion(ind),
    strategyEmaCrossover(ind),
  ]

  const consensus = aggregateStrategies(strategyResults)

  return {
    signal: consensus.signal,
    confidence: consensus.confidence,
    strategies: strategyResults,
    reason: consensus.reason,
  }
}

// ─── Risk exit check (mirrors trading.ts shouldCloseForRisk) ─────

interface RiskExitResult {
  shouldClose: boolean
  shouldPartialClose: boolean
  reason: string
  reasonType: string
}

function checkRiskExit(pos: SimPosition, currentPrice: number, daysHeld: number, signal: SignalDirection): RiskExitResult {
  const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100

  // 1. Hard stop-loss
  if (pnlPct <= STOP_LOSS_PCT) {
    return { shouldClose: true, shouldPartialClose: false, reason: `Stop-loss at ${pnlPct.toFixed(1)}%`, reasonType: 'stop_loss' }
  }

  // 2. Partial profit
  if (pnlPct >= PARTIAL_PROFIT_PCT && !pos.partialExitTaken) {
    return { shouldClose: false, shouldPartialClose: true, reason: `Partial profit at +${pnlPct.toFixed(1)}%`, reasonType: 'partial_profit' }
  }

  // 3. Breakeven after partial
  if (pos.partialExitTaken && pnlPct <= 0) {
    return { shouldClose: true, shouldPartialClose: false, reason: `Breakeven exit at ${pnlPct.toFixed(1)}%`, reasonType: 'breakeven_exit' }
  }

  // 4. Take-profit
  if (pnlPct >= TAKE_PROFIT_PCT) {
    return { shouldClose: true, shouldPartialClose: false, reason: `Take-profit at +${pnlPct.toFixed(1)}%`, reasonType: 'take_profit' }
  }

  // 5. Trailing stop
  const peakGainPct = pos.peakPrice > 0 ? ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0
  if (peakGainPct >= TRAILING_TRIGGER_PCT && pnlPct < peakGainPct * TRAILING_PROTECT_FRAC) {
    return { shouldClose: true, shouldPartialClose: false, reason: `Trailing stop — peaked +${peakGainPct.toFixed(1)}%, now ${pnlPct.toFixed(1)}%`, reasonType: 'trailing_stop' }
  }

  // 6. Time exit
  if (daysHeld >= TIME_EXIT_DAYS && Math.abs(pnlPct) < TIME_EXIT_MIN_PCT) {
    return { shouldClose: true, shouldPartialClose: false, reason: `Time exit — ${daysHeld}d, only ${pnlPct.toFixed(1)}% move`, reasonType: 'time_exit' }
  }

  // 7. Strategy signal to sell
  if (signal === 'SELL') {
    return { shouldClose: true, shouldPartialClose: false, reason: 'Strategy SELL signal', reasonType: 'signal_sell' }
  }

  return { shouldClose: false, shouldPartialClose: false, reason: '', reasonType: 'none' }
}

// ─── Metrics computation ─────────────────────────────────────────

function computeMetrics(
  trades: SimTrade[],
  equityCurve: { date: string; equity: number }[],
  startingCapital: number
): Omit<BacktestMetrics, 'trades'> {
  const closedTrades = trades.filter((t) => t.exitPrice != null)

  // Win/loss arrays
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0)
  const losses = closedTrades.filter((t) => (t.pnl ?? 0) <= 0)
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0

  const avgWinPct = wins.length > 0
    ? wins.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / wins.length
    : 0
  const avgLossPct = losses.length > 0
    ? losses.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / losses.length
    : 0

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0)

  // Sharpe ratio from daily equity returns
  const dailyReturns: number[] = []
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEq = equityCurve[i - 1].equity
    const currEq = equityCurve[i].equity
    if (prevEq > 0) {
      dailyReturns.push((currEq - prevEq) / prevEq)
    }
  }
  const avgReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0
  const variance = dailyReturns.length > 0
    ? dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length
    : 0
  const stdDev = Math.sqrt(variance)
  // Annualised: daily return * sqrt(252)
  const sharpeRatio = stdDev > 0
    ? (avgReturn / stdDev) * Math.sqrt(252)
    : null

  // Max drawdown
  let peak = equityCurve.length > 0 ? equityCurve[0].equity : startingCapital
  let maxDD = 0
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity
    const dd = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0
    if (dd > maxDD) maxDD = dd
  }

  // Average hold duration
  const avgHoldDays = closedTrades.length > 0
    ? closedTrades.reduce((s, t) => {
        if (t.entryDate && t.exitDate) {
          return s + (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000
        }
        return s
      }, 0) / closedTrades.length
    : 0

  // Per-strategy stats
  const strategyStats: BacktestMetrics['strategyStats'] = {}
  for (const t of closedTrades) {
    const key = t.strategy || t.entryReason || 'unknown'
    if (!strategyStats[key]) {
      strategyStats[key] = { trades: 0, wins: 0, losses: 0, winRate: 0, avgPnlPct: 0, totalPnl: 0 }
    }
    const ss = strategyStats[key]
    ss.trades++
    ss.totalPnl += t.pnl ?? 0
    if ((t.pnl ?? 0) > 0) ss.wins++
    else ss.losses++
  }
  for (const key of Object.keys(strategyStats)) {
    const ss = strategyStats[key]
    ss.winRate = ss.trades > 0 ? (ss.wins / ss.trades) * 100 : 0
    const stratTrades = closedTrades.filter((t) => (t.strategy || t.entryReason || 'unknown') === key)
    ss.avgPnlPct = stratTrades.length > 0
      ? stratTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / stratTrades.length
      : 0
  }

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : startingCapital
  const totalReturnPct = ((finalEquity - startingCapital) / startingCapital) * 100

  return {
    startingCapital,
    finalEquity,
    totalReturnPct,
    totalTrades: closedTrades.length,
    winRate,
    sharpeRatio,
    maxDrawdownPct: maxDD,
    profitFactor: profitFactor === Infinity ? 99 : profitFactor,
    avgWinPct,
    avgLossPct,
    avgHoldDays,
    equityCurve,
    strategyStats,
  }
}

// ─── Core simulation ──────────────────────────────────────────────

/**
 * Run a full backtest.
 * 
 * Walks forward day-by-day through the backtest period. On each trading day:
 *   1. Risk-manage existing positions (stop-loss, take-profit, trailing stop, etc.)
 *   2. Scan all symbols for new BUY signals using the exact same consensus logic
 *   3. Execute buys with position sizing (4%/6%/8% by confidence)
 *   4. Record equity at close
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestMetrics> {
  const startingCapital = config.startingCapital ?? STARTING_CAPITAL

  // ── 1. Fetch historical data for all symbols ──
  const symbolData: Map<string, BacktestKline[]> = new Map()
  const fetchErrors: string[] = []

  const batchSize = 5
  for (let i = 0; i < config.symbols.length; i += batchSize) {
    const batch = config.symbols.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map((sym) => fetchHistoricalKlines(sym, config.startDate, config.endDate))
    )
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        symbolData.set(batch[idx], r.value)
      } else if (r.status === 'rejected') {
        fetchErrors.push(`${batch[idx]}: ${r.reason}`)
      }
    })
  }

  if (symbolData.size === 0) {
    throw new Error(`No historical data for any symbol. Errors: ${fetchErrors.join('; ')}`)
  }

  // ── 2. Build the master date list (union of all symbols' dates) ──
  const allDates = new Set<string>()
  for (const klines of symbolData.values()) {
    for (const k of klines) {
      // Only include dates in the backtest period
      if (k.date >= config.startDate && k.date <= config.endDate) {
        allDates.add(k.date)
      }
    }
  }
  const tradingDates = Array.from(allDates).sort()

  if (tradingDates.length === 0) {
    throw new Error('No trading dates found in the specified range')
  }

  // ── 3. Simulation state ──
  let cash = startingCapital
  const positions: SimPosition[] = []
  const trades: SimTrade[] = []
  const equityCurve: { date: string; equity: number }[] = []

  // ── 4. Walk forward ──
  for (const date of tradingDates) {
    // Skip if this is a Saturday/Sunday (shouldn't have data but just in case)
    const dayOfWeek = new Date(date).getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

    // ── 4a. Get closing prices for all symbols on this date ──
    const dayPrices: Map<string, BacktestKline> = new Map()
    for (const [symbol, klines] of symbolData) {
      const bar = klines.find((k) => k.date === date)
      if (bar) dayPrices.set(symbol, bar)
    }

    // ── 4b. Risk-manage existing positions FIRST ──
    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i]
      const bar = dayPrices.get(pos.symbol)
      if (!bar) continue

      const currentPrice = bar.close
      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100

      // Update peak/trough
      if (currentPrice > pos.peakPrice) pos.peakPrice = currentPrice
      if (pos.troughPrice === 0 || currentPrice < pos.troughPrice) pos.troughPrice = currentPrice

      // Evaluate signal for held position
      const symbolKlines = symbolData.get(pos.symbol)!
      const barIndex = symbolKlines.findIndex((k) => k.date === date)
      if (barIndex < 0) continue

      const { signal } = evaluateSignal(symbolKlines, barIndex)
      const daysHeld = Math.round(
        (new Date(date).getTime() - new Date(pos.entryDate).getTime()) / 86400000
      )

      const risk = checkRiskExit(pos, currentPrice, daysHeld, signal)

      // Handle partial profit
      if (risk.shouldPartialClose && !pos.partialExitTaken) {
        const sellQty = pos.quantity * 0.5
        const partialPnl = (currentPrice - pos.entryPrice) * sellQty
        cash += sellQty * currentPrice
        pos.quantity -= sellQty
        pos.partialExitTaken = true
        // Record partial as a separate mini-trade
        trades.push({
          symbol: pos.symbol,
          side: 'sell',
          entryDate: pos.entryDate,
          exitDate: date,
          entryPrice: pos.entryPrice,
          exitPrice: currentPrice,
          quantity: sellQty,
          pnl: partialPnl,
          pnlPct,
          exitReason: 'partial_profit',
          entryReason: pos.entryReason,
          strategy: pos.strategy,
          maxFavorable: ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100,
          maxAdverse: pos.troughPrice > 0 ? ((pos.troughPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0,
        })
      }

      if (risk.shouldClose) {
        const pnl = (currentPrice - pos.entryPrice) * pos.quantity
        cash += pos.quantity * currentPrice
        trades.push({
          symbol: pos.symbol,
          side: 'sell',
          entryDate: pos.entryDate,
          exitDate: date,
          entryPrice: pos.entryPrice,
          exitPrice: currentPrice,
          quantity: pos.quantity,
          pnl,
          pnlPct,
          exitReason: risk.reasonType,
          entryReason: pos.entryReason,
          strategy: pos.strategy,
          maxFavorable: ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100,
          maxAdverse: pos.troughPrice > 0 ? ((pos.troughPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0,
        })
        positions.splice(i, 1)
      }
    }

    // ── 4c. Compute current equity (cash + positions at close) ──
    let currentEquity = cash
    for (const pos of positions) {
      const bar = dayPrices.get(pos.symbol)
      if (bar) currentEquity += pos.quantity * bar.close
    }

    // ── 4d. Circuit breaker check (mirrors trading.ts) ──
    const drawdownPct = startingCapital > 0
      ? ((startingCapital - currentEquity) / startingCapital) * 100
      : 0

    // Today's closed-trade P&L
    const todayDateStr = date
    const todayPnl = trades
      .filter((t) => t.exitDate === todayDateStr)
      .reduce((s, t) => s + (t.pnl ?? 0), 0)

    const circuitBreakerActive =
      drawdownPct > CIRCUIT_BREAKER_DRAWDOWN_PCT ||
      todayPnl < -(currentEquity * CIRCUIT_BREAKER_DAILY_LOSS_PCT / 100)

    // ── 4e. Scan for new BUY signals (skip if circuit breaker active) ──
    if (!circuitBreakerActive && positions.length < MAX_POSITIONS) {
      const cashReserve = currentEquity * CASH_RESERVE_PCT
      const investable = cash - cashReserve
      if (investable >= 500) {
        type Candidate = {
          symbol: string
          confidence: number
          price: number
          strategy: string
          reason: string
          rsi14: number
        }
        const candidates: Candidate[] = []

        for (const [symbol, klines] of symbolData) {
          // Skip if already holding
          if (positions.some((p) => p.symbol === symbol)) continue

          const barIndex = klines.findIndex((k) => k.date === date)
          if (barIndex < 26) continue // need enough data for indicators

          const result = evaluateSignal(klines, barIndex)
          if (result.signal !== 'BUY') continue

          // Entry threshold: same as live trading
          const activeStrats = result.strategies.filter((s) => s.signal !== 'HOLD').length
          const minConfidence = activeStrats >= 2 ? 70 : 80
          if (result.confidence < minConfidence) continue

          // Reject overbought
          const ind = computeIndicators(klines.slice(Math.max(0, barIndex - 119), barIndex + 1))
          if (ind && ind.rsi14 > 70) continue

          const bar = dayPrices.get(symbol)!
          candidates.push({
            symbol,
            confidence: result.confidence,
            price: bar.close,
            strategy: result.strategies.filter((s) => s.signal === 'BUY').map((s) => s.name).join('+'),
            reason: result.reason,
            rsi14: ind?.rsi14 ?? 50,
          })
        }

        // Sort by confidence descending
        candidates.sort((a, b) => b.confidence - a.confidence)

        // Execute buys — sizing based on CURRENT equity (mirrors live trading)
        const slotsAvailable = MAX_POSITIONS - positions.length
        for (const c of candidates.slice(0, slotsAvailable)) {
          const investableNow = cash - currentEquity * CASH_RESERVE_PCT
          if (investableNow < 500) break

          // Position sizing based on current equity (same as live trading)
          let allocationPct = 0.04
          if (c.confidence >= 90) allocationPct = 0.08
          else if (c.confidence >= 80) allocationPct = 0.06
          else allocationPct = 0.04

          const targetAlloc = currentEquity * allocationPct
          const allocation = Math.min(targetAlloc, investableNow)
          if (allocation < 100) continue

          const qty = allocation / c.price
          cash -= qty * c.price

          positions.push({
            symbol: c.symbol,
            entryPrice: c.price,
            quantity: qty,
            entryDate: date,
            peakPrice: c.price,
            troughPrice: c.price,
            partialExitTaken: false,
            strategy: c.strategy,
            entryReason: activeStratsForReason(c.strategy),
          })
        }
      }
    }

    // ── 4f. Record equity ──
    let equity = cash
    for (const pos of positions) {
      const bar = dayPrices.get(pos.symbol)
      if (bar) {
        equity += pos.quantity * bar.close
      }
    }
    equityCurve.push({ date, equity })
  }

  // ── 5. Close any remaining open positions at the last available price ──
  const lastDate = tradingDates[tradingDates.length - 1]
  for (const pos of positions) {
    const klines = symbolData.get(pos.symbol)
    if (!klines) continue
    const lastBar = klines[klines.length - 1]
    const pnl = (lastBar.close - pos.entryPrice) * pos.quantity
    cash += pos.quantity * lastBar.close
    trades.push({
      symbol: pos.symbol,
      side: 'sell',
      entryDate: pos.entryDate,
      exitDate: lastDate,
      entryPrice: pos.entryPrice,
      exitPrice: lastBar.close,
      quantity: pos.quantity,
      pnl,
      pnlPct: ((lastBar.close - pos.entryPrice) / pos.entryPrice) * 100,
      exitReason: 'backtest_end',
      entryReason: pos.entryReason,
      strategy: pos.strategy,
      maxFavorable: ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100,
      maxAdverse: pos.troughPrice > 0 ? ((pos.troughPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0,
    })
  }

  // ── 6. Compute metrics ──
  const metrics = computeMetrics(trades, equityCurve, startingCapital)
  return { ...metrics, trades }
}

function activeStratsForReason(strategyStr: string): string {
  if (strategyStr.includes('+')) return 'consensus'
  return strategyStr.toLowerCase().replace(/\s+/g, '_')
}

// ─── Persistence ──────────────────────────────────────────────────

export async function saveBacktest(
  config: BacktestConfig,
  metrics: BacktestMetrics
): Promise<number> {
  const name = config.name || `Backtest ${new Date().toLocaleDateString()}`

  const backtest = await prisma.backtest.create({
    data: {
      name,
      startDate: new Date(config.startDate),
      endDate: new Date(config.endDate),
      symbols: JSON.stringify(config.symbols),
      startingCapital: metrics.startingCapital,
      finalEquity: metrics.finalEquity,
      totalReturnPct: metrics.totalReturnPct,
      totalTrades: metrics.totalTrades,
      winRate: metrics.winRate,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdownPct: metrics.maxDrawdownPct,
      profitFactor: metrics.profitFactor,
      avgWinPct: metrics.avgWinPct,
      avgLossPct: metrics.avgLossPct,
      avgHoldDays: metrics.avgHoldDays,
      equityCurve: metrics.equityCurve,
      strategyStats: metrics.strategyStats as any,
      trades: {
        create: metrics.trades.map((t) => ({
          symbol: t.symbol,
          side: t.side,
          entryDate: new Date(t.entryDate),
          exitDate: t.exitDate ? new Date(t.exitDate) : null,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          quantity: t.quantity,
          pnl: t.pnl,
          pnlPct: t.pnlPct,
          exitReason: t.exitReason,
          entryReason: t.entryReason,
          strategy: t.strategy,
          maxFavorable: t.maxFavorable,
          maxAdverse: t.maxAdverse,
        })),
      },
    },
  })

  return backtest.id
}

export async function getBacktest(id: number) {
  return prisma.backtest.findUnique({
    where: { id },
    include: { trades: { orderBy: { entryDate: 'asc' } } },
  })
}

export async function listBacktests() {
  return prisma.backtest.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      totalReturnPct: true,
      winRate: true,
      totalTrades: true,
      createdAt: true,
    },
  })
}

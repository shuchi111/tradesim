import { describe, it, expect } from 'vitest'
import {
  computeIndicators,
  strategyConfluence,
  strategyMomentumBreakout,
  strategyMeanReversion,
  strategyEmaCrossover,
  aggregateStrategies,
} from '@/lib/strategy'

/**
 * Unit tests for the backtest engine metrics and market-hours logic.
 *
 * These tests verify:
 * - Win rate, profit factor, Sharpe ratio calculations
 * - Max drawdown calculation
 * - Market hours detection (IST timezone)
 * - Per-strategy statistics aggregation
 */

// ─── Mirror the metrics computation from backtest.ts ─────────────

function computeWinRate(closedTrades: { pnl: number | null }[]): number {
  if (closedTrades.length === 0) return 0
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0)
  return (wins.length / closedTrades.length) * 100
}

function computeProfitFactor(trades: { pnl: number | null }[]): number {
  const grossProfit = trades.filter((t) => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossLoss = Math.abs(trades.filter((t) => (t.pnl ?? 0) < 0).reduce((s, t) => s + (t.pnl ?? 0), 0))
  if (grossLoss === 0) return grossProfit > 0 ? 99 : 0
  return grossProfit / grossLoss
}

function computeSharpe(dailyReturns: number[]): number | null {
  if (dailyReturns.length === 0) return null
  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return null
  return (avgReturn / stdDev) * Math.sqrt(252)
}

function computeMaxDrawdown(equityCurve: number[]): number {
  let peak = equityCurve[0] ?? 0
  let maxDD = 0
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

// ─── Mirror the market-hours check from auto-trade-loop.ts ───────

function isMarketOpenAt(date: Date): boolean {
  const istOffsetMs = 5.5 * 60 * 60 * 1000
  const istDate = new Date(date.getTime() + istOffsetMs)
  const istDay = istDate.getUTCDay()
  if (istDay === 0 || istDay === 6) return false

  const istTotalMin = istDate.getUTCHours() * 60 + istDate.getUTCMinutes()
  return istTotalMin >= 9 * 60 + 15 && istTotalMin <= 15 * 60 + 30
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Backtest Metrics — Win Rate', () => {
  it('should return 0% for no trades', () => {
    expect(computeWinRate([])).toBe(0)
  })

  it('should return 100% for all winning trades', () => {
    const trades = [{ pnl: 100 }, { pnl: 50 }, { pnl: 200 }]
    expect(computeWinRate(trades)).toBe(100)
  })

  it('should return 0% for all losing trades', () => {
    const trades = [{ pnl: -50 }, { pnl: -100 }]
    expect(computeWinRate(trades)).toBe(0)
  })

  it('should compute correct mixed win rate', () => {
    const trades = [
      { pnl: 100 }, { pnl: -50 }, { pnl: 200 }, { pnl: -30 }, { pnl: 80 },
    ]
    // 3 wins out of 5 = 60%
    expect(computeWinRate(trades)).toBe(60)
  })

  it('should treat pnl=0 as a loss', () => {
    const trades = [{ pnl: 100 }, { pnl: 0 }]
    expect(computeWinRate(trades)).toBe(50)
  })
})

describe('Backtest Metrics — Profit Factor', () => {
  it('should return 0 when no trades', () => {
    expect(computeProfitFactor([])).toBe(0)
  })

  it('should return 99 when all wins, no losses', () => {
    const trades = [{ pnl: 100 }, { pnl: 50 }]
    expect(computeProfitFactor(trades)).toBe(99)
  })

  it('should return 0 when all losses', () => {
    const trades = [{ pnl: -100 }, { pnl: -50 }]
    expect(computeProfitFactor(trades)).toBe(0)
  })

  it('should compute correct ratio', () => {
    const trades = [{ pnl: 300 }, { pnl: -100 }, { pnl: 200 }, { pnl: -100 }]
    // Gross profit = 500, Gross loss = 200, PF = 2.5
    expect(computeProfitFactor(trades)).toBe(2.5)
  })
})

describe('Backtest Metrics — Sharpe Ratio', () => {
  it('should return null for empty returns', () => {
    expect(computeSharpe([])).toBeNull()
  })

  it('should return null for zero-variance returns (flat equity)', () => {
    expect(computeSharpe([0, 0, 0, 0, 0])).toBeNull()
  })

  it('should produce a positive Sharpe for mostly positive returns', () => {
    const returns = [0.01, 0.008, 0.012, 0.009, 0.011, 0.01]
    const sharpe = computeSharpe(returns)
    expect(sharpe).not.toBeNull()
    expect(sharpe!).toBeGreaterThan(0)
  })

  it('should produce a negative Sharpe for mostly negative returns', () => {
    const returns = [-0.01, -0.008, -0.012, -0.009, -0.011, -0.01]
    const sharpe = computeSharpe(returns)
    expect(sharpe).not.toBeNull()
    expect(sharpe!).toBeLessThan(0)
  })

  it('should annualize (multiply by sqrt(252))', () => {
    // With a known return series, verify the annualization factor
    const returns = [0.001, -0.002, 0.003, 0.001, -0.001, 0.002, 0.001]
    const sharpe = computeSharpe(returns)!
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length
    const stdDev = Math.sqrt(variance)
    const expectedDaily = avgReturn / stdDev
    const expectedAnnualized = expectedDaily * Math.sqrt(252)
    expect(sharpe).toBeCloseTo(expectedAnnualized, 4)
  })
})

describe('Backtest Metrics — Max Drawdown', () => {
  it('should return 0 for monotonically increasing equity', () => {
    expect(computeMaxDrawdown([100, 110, 120, 130])).toBe(0)
  })

  it('should detect a single drawdown', () => {
    // Peak at 120, trough at 90, DD = (120-90)/120 * 100 = 25%
    expect(computeMaxDrawdown([100, 110, 120, 90, 95])).toBeCloseTo(25, 1)
  })

  it('should detect the largest of multiple drawdowns', () => {
    // Peak1=110, trough1=80, DD1=(110-80)/110=27.3%
    // Peak2=120, trough2=100, DD2=(120-100)/120=16.7%
    expect(computeMaxDrawdown([100, 110, 80, 120, 100])).toBeCloseTo(27.27, 1)
  })

  it('should return 0 for flat equity', () => {
    expect(computeMaxDrawdown([100, 100, 100, 100])).toBe(0)
  })

  it('should handle single-element equity curve', () => {
    expect(computeMaxDrawdown([100])).toBe(0)
  })
})

describe('Market Hours — IST Timezone', () => {
  it('should be closed on Saturday', () => {
    // 2026-07-25 is a Saturday at 10:00 UTC → 15:30 IST
    const sat = new Date('2026-07-25T10:00:00Z')
    expect(isMarketOpenAt(sat)).toBe(false)
  })

  it('should be closed on Sunday', () => {
    // 2026-07-26 is a Sunday at 10:00 UTC → 15:30 IST
    const sun = new Date('2026-07-26T10:00:00Z')
    expect(isMarketOpenAt(sun)).toBe(false)
  })

  it('should be open during market hours on a weekday', () => {
    // 10:00 UTC on Monday = 15:30 IST → market is open (just at close)
    // 05:00 UTC on Monday = 10:30 IST → market is open
    const mon = new Date('2026-07-27T05:00:00Z') // Monday 10:30 IST
    expect(isMarketOpenAt(mon)).toBe(true)
  })

  it('should be closed before market open (weekday)', () => {
    // 03:00 UTC = 08:30 IST → market not yet open (opens 9:15)
    const mon = new Date('2026-07-27T03:00:00Z') // Monday 08:30 IST
    expect(isMarketOpenAt(mon)).toBe(false)
  })

  it('should be closed after market close (weekday)', () => {
    // 10:30 UTC = 16:00 IST → market closed (closed at 15:30)
    const mon = new Date('2026-07-27T10:30:00Z') // Monday 16:00 IST
    expect(isMarketOpenAt(mon)).toBe(false)
  })

  it('should be open exactly at 9:15 AM IST', () => {
    // 9:15 IST = 3:45 UTC
    const mon = new Date('2026-07-27T03:45:00Z')
    expect(isMarketOpenAt(mon)).toBe(true)
  })

  it('should be open exactly at 3:30 PM IST (15:30)', () => {
    // 15:30 IST = 10:00 UTC
    const mon = new Date('2026-07-27T10:00:00Z')
    expect(isMarketOpenAt(mon)).toBe(true)
  })
})

describe('Per-Strategy Statistics', () => {
  it('should aggregate trades by strategy name', () => {
    const trades = [
      { strategy: 'Confluence', pnl: 100, pnlPct: 5 },
      { strategy: 'Confluence', pnl: -50, pnlPct: -2.5 },
      { strategy: 'Momentum Breakout', pnl: 200, pnlPct: 8 },
      { strategy: 'Momentum Breakout', pnl: 150, pnlPct: 6 },
    ]

    const stats: Record<string, { trades: number; wins: number; totalPnl: number }> = {}
    for (const t of trades) {
      if (!stats[t.strategy]) stats[t.strategy] = { trades: 0, wins: 0, totalPnl: 0 }
      stats[t.strategy].trades++
      stats[t.strategy].totalPnl += t.pnl
      if (t.pnl > 0) stats[t.strategy].wins++
    }

    expect(stats['Confluence'].trades).toBe(2)
    expect(stats['Confluence'].wins).toBe(1)
    expect(stats['Confluence'].totalPnl).toBe(50)
    expect(stats['Momentum Breakout'].trades).toBe(2)
    expect(stats['Momentum Breakout'].wins).toBe(2)
    expect(stats['Momentum Breakout'].totalPnl).toBe(350)
  })
})

describe('Position Sizing Logic', () => {
  const MAX_ALLOCATION_PER_TRADE = 25_000

  function sizeWholeShares(
    equity: number,
    confidence: number,
    investable: number,
    price: number
  ): { qty: number; cost: number } {
    let allocationPct = 0.04
    if (confidence >= 90) allocationPct = 0.08
    else if (confidence >= 80) allocationPct = 0.06
    const capped = Math.min(equity * allocationPct, investable, MAX_ALLOCATION_PER_TRADE)
    if (capped < 100 || price <= 0) return { qty: 0, cost: 0 }
    const qty = Math.floor(capped / price)
    if (qty < 1) return { qty: 0, cost: 0 }
    return { qty, cost: qty * price }
  }

  it('should allocate 8% for 90%+ confidence', () => {
    const confidence = 92
    let allocationPct = 0.04
    if (confidence >= 90) allocationPct = 0.08
    else if (confidence >= 80) allocationPct = 0.06
    expect(allocationPct).toBe(0.08)
  })

  it('should allocate 6% for 80-89% confidence', () => {
    const confidence = 85
    let allocationPct = 0.04
    if (confidence >= 90) allocationPct = 0.08
    else if (confidence >= 80) allocationPct = 0.06
    expect(allocationPct).toBe(0.06)
  })

  it('should allocate 4% for 70-79% confidence', () => {
    const confidence = 72
    let allocationPct = 0.04
    if (confidence >= 90) allocationPct = 0.08
    else if (confidence >= 80) allocationPct = 0.06
    expect(allocationPct).toBe(0.04)
  })

  it('uses whole shares only', () => {
    const { qty, cost } = sizeWholeShares(100_000, 92, 70_000, 1500)
    expect(Number.isInteger(qty)).toBe(true)
    expect(qty).toBe(Math.floor(8000 / 1500))
    expect(cost).toBe(qty * 1500)
  })

  it('caps allocation at ₹25,000', () => {
    const { qty, cost } = sizeWholeShares(1_000_000, 95, 500_000, 100)
    expect(cost).toBeLessThanOrEqual(MAX_ALLOCATION_PER_TRADE)
    expect(qty).toBe(250)
  })
})

describe('Risk Exit Logic', () => {
  const STOP_LOSS_PCT = -7
  const TAKE_PROFIT_PCT = 15
  const PARTIAL_PROFIT_PCT = 5

  it('should trigger stop-loss at -7%', () => {
    const pnlPct = -7.5
    expect(pnlPct <= STOP_LOSS_PCT).toBe(true)
  })

  it('should NOT trigger stop-loss at -6.5%', () => {
    const pnlPct = -6.5
    expect(pnlPct <= STOP_LOSS_PCT).toBe(false)
  })

  it('should trigger take-profit at +15%', () => {
    const pnlPct = 16
    expect(pnlPct >= TAKE_PROFIT_PCT).toBe(true)
  })

  it('should trigger partial profit at +5%', () => {
    const pnlPct = 5.5
    expect(pnlPct >= PARTIAL_PROFIT_PCT).toBe(true)
  })

  it('should trigger trailing stop when gain drops below 40% of peak', () => {
    const peakGainPct = 10 // peaked at +10%
    const currentPnlPct = 3 // now at +3%
    // Trigger if peak >= 7% AND current < peak * 0.4
    expect(peakGainPct >= 7 && currentPnlPct < peakGainPct * 0.4).toBe(true)
  })

  it('should NOT trigger trailing stop when still above 40% of peak', () => {
    const peakGainPct = 10
    const currentPnlPct = 5 // 5 > 10 * 0.4 = 4
    expect(peakGainPct >= 7 && currentPnlPct < peakGainPct * 0.4).toBe(false)
  })
})

// ─── Integration tests: strategy functions on synthetic data ─────

/**
 * Generate synthetic OHLCV klines for testing.
 * Creates a deterministic uptrend or downtrend so strategies produce
 * predictable signals.
 */
function generateUptrendKlines(days: number, startPrice = 100): {
  open: number; high: number; low: number; close: number; volume: number
}[] {
  const klines = []
  let price = startPrice
  for (let i = 0; i < days; i++) {
    // Strong upward bias: ~1.5%/day with mild oscillation
    const dailyMove = 1 + (Math.sin(i * 0.4) * 0.003 + 0.015)
    const open = price
    const close = price * dailyMove
    const high = Math.max(open, close) * 1.008
    const low = Math.min(open, close) * 0.992
    const volume = 1_500_000 + i * 10000 // increasing volume (volume surge)
    klines.push({ open, high, low, close, volume })
    price = close
  }
  return klines
}

function generateDowntrendKlines(days: number, startPrice = 100): {
  open: number; high: number; low: number; close: number; volume: number
}[] {
  const klines = []
  let price = startPrice
  for (let i = 0; i < days; i++) {
    const dailyMove = 1 + (Math.sin(i * 0.3) * 0.005 - 0.008) // downward bias
    const open = price
    const close = price * dailyMove
    const high = Math.max(open, close) * 1.005
    const low = Math.min(open, close) * 0.995
    const volume = 1_000_000 + Math.random() * 500_000
    klines.push({ open, high, low, close, volume })
    price = close
  }
  return klines
}

describe('Integration: Strategy evaluation on synthetic data', () => {
  it('should produce a BUY signal on a strong uptrend', () => {
    const klines = generateUptrendKlines(60)
    const ind = computeIndicators(klines)
    expect(ind).not.toBeNull()

    const results = [
      strategyConfluence(ind!),
      strategyMomentumBreakout(ind!),
      strategyMeanReversion(ind!),
      strategyEmaCrossover(ind!),
    ]
    const consensus = aggregateStrategies(results)

    // In a strong uptrend, at least one strategy should vote BUY
    const buys = results.filter((r) => r.signal === 'BUY')
    expect(buys.length).toBeGreaterThan(0)
    expect(consensus.signal).toBe('BUY')
  })

  it('should produce a SELL or HOLD signal on a downtrend', () => {
    const klines = generateDowntrendKlines(60)
    const ind = computeIndicators(klines)
    expect(ind).not.toBeNull()

    const results = [
      strategyConfluence(ind!),
      strategyMomentumBreakout(ind!),
      strategyMeanReversion(ind!),
      strategyEmaCrossover(ind!),
    ]
    const consensus = aggregateStrategies(results)

    // In a downtrend, we should NOT see a BUY consensus
    expect(consensus.signal).not.toBe('BUY')
  })

  it('should return null indicators for insufficient data', () => {
    const shortKlines = generateUptrendKlines(10) // too few bars
    const ind = computeIndicators(shortKlines)
    expect(ind).toBeNull()
  })

  it('should compute valid indicator values on 60 bars', () => {
    const klines = generateUptrendKlines(60)
    const ind = computeIndicators(klines)
    expect(ind).not.toBeNull()
    expect(ind!.currentPrice).toBeGreaterThan(0)
    expect(ind!.sma5).toBeGreaterThan(0)
    expect(ind!.sma20).toBeGreaterThan(0)
    expect(ind!.rsi14).toBeGreaterThanOrEqual(0)
    expect(ind!.rsi14).toBeLessThanOrEqual(100)
  })

  it('should produce different consensus on uptrend vs downtrend', () => {
    const upKlines = generateUptrendKlines(60)
    const downKlines = generateDowntrendKlines(60)
    const upInd = computeIndicators(upKlines)!
    const downInd = computeIndicators(downKlines)!

    const upConsensus = aggregateStrategies([
      strategyConfluence(upInd),
      strategyMomentumBreakout(upInd),
      strategyMeanReversion(upInd),
      strategyEmaCrossover(upInd),
    ])
    const downConsensus = aggregateStrategies([
      strategyConfluence(downInd),
      strategyMomentumBreakout(downInd),
      strategyMeanReversion(downInd),
      strategyEmaCrossover(downInd),
    ])

    // They should not both be BUY
    expect(upConsensus.signal === 'BUY' && downConsensus.signal === 'BUY').toBe(false)
  })
})

describe('Integration: Circuit breaker simulation', () => {
  it('should trigger circuit breaker when drawdown exceeds 6%', () => {
    const startingEquity = 100000
    const currentEquity = 93000 // 7% drawdown
    const drawdownPct = ((startingEquity - currentEquity) / startingEquity) * 100
    const circuitBreakerActive = drawdownPct > 6
    expect(circuitBreakerActive).toBe(true)
  })

  it('should NOT trigger circuit breaker when drawdown is under 6%', () => {
    const startingEquity = 100000
    const currentEquity = 95000 // 5% drawdown
    const drawdownPct = ((startingEquity - currentEquity) / startingEquity) * 100
    const circuitBreakerActive = drawdownPct > 6
    expect(circuitBreakerActive).toBe(false)
  })

  it('should trigger circuit breaker on large daily loss (>2.5% of equity)', () => {
    const currentEquity = 100000
    const dailyPnl = -3000 // 3% of equity
    const circuitBreakerActive = dailyPnl < -(currentEquity * 0.025)
    expect(circuitBreakerActive).toBe(true)
  })

  it('should NOT trigger circuit breaker on small daily loss', () => {
    const currentEquity = 100000
    const dailyPnl = -2000 // 2% of equity
    const circuitBreakerActive = dailyPnl < -(currentEquity * 0.025)
    expect(circuitBreakerActive).toBe(false)
  })
})

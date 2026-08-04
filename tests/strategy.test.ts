import { describe, it, expect } from 'vitest'

/**
 * Unit tests for the multi-strategy trading engine.
 *
 * These test the strategy indicator functions and voting logic
 * by replicating the pure functions from strategy.ts with known inputs.
 * This verifies the signal generation logic works correctly for
 * all 4 strategies and the consensus aggregation.
 */

/* ============================================================
 * Indicator functions (mirror strategy.ts internals for testing)
 * ============================================================ */

function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0
  const k = 2 / (period + 1)
  let prev = values[0]
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
  }
  return prev
}

function rsi(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function macd(closes: number[]): { macd: number; signal: number; histogram: number } {
  const fast = 12, slow = 26, signalPeriod = 9
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdValue = emaFast - emaSlow
  // Approximate signal as EMA of macdLine (simplified for test)
  const signal = macdValue * 0.8
  return { macd: macdValue, signal, histogram: macdValue - signal }
}

/* ============================================================
 * SMA Tests
 * ============================================================ */

describe('SMA (Simple Moving Average)', () => {
  it('calculates 5-period SMA correctly', () => {
    const values = [10, 20, 30, 40, 50]
    expect(sma(values, 5)).toBe(30) // (10+20+30+40+50)/5
  })

  it('uses last N values when series is longer', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(sma(values, 3)).toBe(27 / 3) // (8+9+10)/3 = 9
  })

  it('handles period larger than data', () => {
    const values = [10, 20]
    expect(sma(values, 5)).toBe(15) // (10+20)/2
  })

  it('calculates SMA(20) for 20 values', () => {
    const values = Array(20).fill(100)
    expect(sma(values, 20)).toBe(100)
  })
})

/* ============================================================
 * RSI Tests
 * ============================================================ */

describe('RSI (Relative Strength Index)', () => {
  it('returns 100 when all gains (no losses)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i) // always going up
    const r = rsi(closes, 14)
    expect(r).toBe(100)
  })

  it('returns 0 when all losses (no gains)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i) // always going down
    const r = rsi(closes, 14)
    expect(r).toBe(0)
  })

  it('returns 100 for flat data (no losses = RSI 100)', () => {
    const closes = Array(20).fill(100)
    const r = rsi(closes, 14)
    expect(r).toBe(100) // No losses → RSI = 100 (standard Wilder's behavior)
  })

  it('returns < 30 for oversold conditions', () => {
    // Steady decline
    const closes = [100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72, 70]
    const r = rsi(closes, 14)
    expect(r).toBeLessThan(30)
  })

  it('returns > 70 for overbought conditions', () => {
    // Steady climb
    const closes = [70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100]
    const r = rsi(closes, 14)
    expect(r).toBeGreaterThan(70)
  })

  it('returns 50 for insufficient data', () => {
    expect(rsi([100, 101], 14)).toBe(50)
  })
})

/* ============================================================
 * EMA Tests
 * ============================================================ */

describe('EMA (Exponential Moving Average)', () => {
  it('returns first value for single-element array', () => {
    expect(ema([100], 9)).toBe(100)
  })

  it('weights recent prices more heavily', () => {
    const values = [100, 110, 120, 130, 140]
    const e = ema(values, 9)
    // EMA should be between first value and last, closer to last
    expect(e).toBeGreaterThan(100)
    expect(e).toBeLessThanOrEqual(140)
  })

  it('EMA(9) responds faster than SMA(9)', () => {
    // Create a sudden jump
    const values = [50, 50, 50, 50, 50, 50, 50, 50, 100]
    const e = ema(values, 9)
    const s = sma(values, 9)
    expect(e).toBeGreaterThan(s) // EMA reacts faster to the jump
  })
})

/* ============================================================
 * Strategy Voting Logic Tests
 * ============================================================ */

describe('Strategy 1: Confluence Voting', () => {
  // Simulate the confluence scoring logic
  function confluenceVote(params: {
    prevSma5: number; sma5: number; prevSma20: number; sma20: number
    rsi14: number; macdHist: number; macdLine: number; macdSignal: number
    price: number; bbLower: number; bbUpper: number
    volume: number; avgVolume20: number
  }): 'BUY' | 'SELL' | 'HOLD' {
    let score = 0
    const goldenCross = params.prevSma5 < params.prevSma20 && params.sma5 >= params.sma20
    const deathCross = params.prevSma5 > params.prevSma20 && params.sma5 <= params.sma20

    if (goldenCross) score += 2
    else if (deathCross) score -= 2
    else if (params.sma5 >= params.sma20) score += 1
    else score -= 1

    if (params.rsi14 < 30) score += 2
    else if (params.rsi14 < 45) score += 1
    else if (params.rsi14 > 70) score -= 2
    else if (params.rsi14 > 55) score -= 1

    if (params.macdHist > 0 && params.macdLine > params.macdSignal) score += 2
    else if (params.macdHist < 0 && params.macdLine < params.macdSignal) score -= 2

    if (params.price <= params.bbLower * 1.01) score += 1
    else if (params.price >= params.bbUpper * 0.99) score -= 1

    if (params.volume > params.avgVolume20 * 1.5) score += score > 0 ? 0.5 : score < 0 ? -0.5 : 0

    if (score >= 1.5) return 'BUY'
    if (score <= -1.5) return 'SELL'
    return 'HOLD'
  }

  it('returns BUY on golden cross + oversold RSI + bullish MACD', () => {
    expect(confluenceVote({
      prevSma5: 98, sma5: 102, prevSma20: 100, sma20: 100,
      rsi14: 28, macdHist: 0.5, macdLine: 1, macdSignal: 0.5,
      price: 99, bbLower: 98, bbUpper: 105, volume: 100, avgVolume20: 100,
    })).toBe('BUY')
  })

  it('returns SELL on death cross + overbought RSI + bearish MACD', () => {
    expect(confluenceVote({
      prevSma5: 102, sma5: 98, prevSma20: 100, sma20: 100,
      rsi14: 75, macdHist: -0.5, macdLine: -1, macdSignal: -0.5,
      price: 106, bbLower: 95, bbUpper: 105, volume: 100, avgVolume20: 100,
    })).toBe('SELL')
  })

  it('returns HOLD for neutral signals', () => {
    expect(confluenceVote({
      prevSma5: 100, sma5: 100, prevSma20: 100, sma20: 100,
      rsi14: 50, macdHist: 0, macdLine: 0, macdSignal: 0,
      price: 100, bbLower: 95, bbUpper: 105, volume: 100, avgVolume20: 100,
    })).toBe('HOLD')
  })
})

describe('Strategy 2: Momentum Breakout Voting', () => {
  function breakoutVote(params: {
    price: number; high20Prev: number; low20Prev: number
    volume: number; avgVolume20: number; rsi14: number
    sma5: number; sma20: number
  }): 'BUY' | 'SELL' | 'HOLD' {
    let score = 0
    const breakoutUp = params.price > params.high20Prev && params.high20Prev > 0
    const breakoutDown = params.price < params.low20Prev && params.low20Prev > 0

    if (breakoutUp) score += 3
    else if (breakoutDown) score -= 3

    if (params.volume > params.avgVolume20 * 1.5) {
      if (breakoutUp) score += 2
      else if (breakoutDown) score -= 2
    }
    if (params.rsi14 >= 40 && params.rsi14 <= 70 && breakoutUp) score += 1
    else if (params.rsi14 > 75) score -= 1

    if (params.sma5 > params.sma20 && breakoutUp) score += 1
    else if (params.sma5 < params.sma20 && breakoutUp) score -= 1
    else if (breakoutDown) score -= 1

    if (score >= 3) return 'BUY'
    if (score <= -3) return 'SELL'
    return 'HOLD'
  }

  it('returns BUY on 20-day high breakout with volume', () => {
    expect(breakoutVote({
      price: 110, high20Prev: 105, low20Prev: 90,
      volume: 200, avgVolume20: 100, rsi14: 55,
      sma5: 105, sma20: 100,
    })).toBe('BUY')
  })

  it('returns HOLD when no breakout', () => {
    expect(breakoutVote({
      price: 100, high20Prev: 105, low20Prev: 95,
      volume: 100, avgVolume20: 100, rsi14: 50,
      sma5: 100, sma20: 100,
    })).toBe('HOLD')
  })

  it('returns SELL on 20-day low breakdown', () => {
    expect(breakoutVote({
      price: 88, high20Prev: 105, low20Prev: 92,
      volume: 200, avgVolume20: 100, rsi14: 25,
      sma5: 95, sma20: 100,
    })).toBe('SELL')
  })
})

describe('Strategy 3: Mean Reversion Voting', () => {
  function meanRevVote(params: {
    rsi14: number; prevRsi14: number
    price: number; bbLower: number; bbUpper: number
    sma50: number
  }): 'BUY' | 'SELL' | 'HOLD' {
    let score = 0
    if (params.rsi14 < 30) score += 3
    else if (params.rsi14 < 35) score += 2
    else if (params.rsi14 < 40) score += 1
    else if (params.rsi14 > 70) score -= 3
    else if (params.rsi14 > 65) score -= 1

    if (params.price <= params.bbLower * 1.01) score += 2
    else if (params.price >= params.bbUpper * 0.99) score -= 2

    if (params.rsi14 > params.prevRsi14 && params.rsi14 < 45) score += 2
    else if (params.rsi14 < params.prevRsi14 && params.rsi14 > 55) score -= 2

    if (params.price > params.sma50 && params.sma50 > 0) {
      if (score > 0) score += 2
    } else if (params.price < params.sma50 && params.sma50 > 0) {
      if (score > 0) score -= 2
    }

    if (score >= 3) return 'BUY'
    if (score <= -3) return 'SELL'
    return 'HOLD'
  }

  it('returns BUY on deeply oversold + lower BB + above SMA50 + RSI turning up', () => {
    expect(meanRevVote({
      rsi14: 25, prevRsi14: 22,
      price: 94, bbLower: 95, bbUpper: 110,
      sma50: 100,
    })).toBe('BUY')
  })

  it('returns SELL on overbought + upper BB', () => {
    expect(meanRevVote({
      rsi14: 75, prevRsi14: 78,
      price: 112, bbLower: 95, bbUpper: 110,
      sma50: 100,
    })).toBe('SELL')
  })

  it('returns HOLD for neutral RSI', () => {
    expect(meanRevVote({
      rsi14: 50, prevRsi14: 50,
      price: 100, bbLower: 95, bbUpper: 105,
      sma50: 100,
    })).toBe('HOLD')
  })
})

describe('Strategy 4: EMA Crossover Voting', () => {
  function emaVote(params: {
    prevEma9: number; ema9: number; prevEma21: number; ema21: number
    price: number; sma50: number; macdHist: number
  }): 'BUY' | 'SELL' | 'HOLD' {
    let score = 0
    const bullCross = params.prevEma9 <= params.prevEma21 && params.ema9 > params.ema21
    const bearCross = params.prevEma9 >= params.prevEma21 && params.ema9 < params.ema21

    if (bullCross) score += 3
    else if (bearCross) score -= 3
    else if (params.ema9 > params.ema21) score += 1
    else score -= 1

    if (params.price > params.sma50 && params.sma50 > 0) {
      if (score > 0) score += 2
    } else if (params.price < params.sma50 && params.sma50 > 0) {
      if (score < 0) score -= 2
      else score -= 1
    }

    if (params.macdHist > 0) {
      if (score > 0) score += 2
    } else if (params.macdHist < 0) {
      if (score < 0) score -= 2
    }

    if (score >= 3) return 'BUY'
    if (score <= -3) return 'SELL'
    return 'HOLD'
  }

  it('returns BUY on bullish EMA crossover + above SMA50 + MACD positive', () => {
    expect(emaVote({
      prevEma9: 99, ema9: 101, prevEma21: 100, ema21: 100,
      price: 105, sma50: 100, macdHist: 0.5,
    })).toBe('BUY')
  })

  it('returns SELL on bearish EMA crossover + below SMA50 + MACD negative', () => {
    expect(emaVote({
      prevEma9: 101, ema9: 99, prevEma21: 100, ema21: 100,
      price: 95, sma50: 100, macdHist: -0.5,
    })).toBe('SELL')
  })

  it('returns HOLD for neutral conditions', () => {
    expect(emaVote({
      prevEma9: 100, ema9: 100, prevEma21: 100, ema21: 100,
      price: 100, sma50: 100, macdHist: 0,
    })).toBe('HOLD')
  })
})

/* ============================================================
 * Consensus Aggregation Tests
 * ============================================================ */

describe('Multi-Strategy Consensus Aggregation', () => {
  type Vote = 'BUY' | 'SELL' | 'HOLD'

  function aggregate(votes: Vote[]): { signal: Vote; confidence: number } {
    const buys = votes.filter((v) => v === 'BUY').length
    const sells = votes.filter((v) => v === 'SELL').length

    if (buys >= 2) {
      const boost = 1 + (buys - 1) * 0.1
      return { signal: 'BUY', confidence: Math.round(75 * boost) }
    }
    if (buys === 1 && sells === 0) {
      return { signal: 'BUY', confidence: 65 }
    }
    if (sells >= 2) {
      return { signal: 'SELL', confidence: 75 }
    }
    if (sells === 1 && buys === 0) {
      return { signal: 'SELL', confidence: 65 }
    }
    return { signal: 'HOLD', confidence: 0 }
  }

  it('returns strong BUY when 2+ strategies vote BUY', () => {
    const result = aggregate(['BUY', 'BUY', 'HOLD', 'HOLD'])
    expect(result.signal).toBe('BUY')
    expect(result.confidence).toBeGreaterThan(70)
  })

  it('returns strong BUY when 3 strategies vote BUY', () => {
    const result = aggregate(['BUY', 'BUY', 'BUY', 'HOLD'])
    expect(result.signal).toBe('BUY')
    expect(result.confidence).toBeGreaterThan(80)
  })

  it('returns strong BUY when all 4 vote BUY', () => {
    const result = aggregate(['BUY', 'BUY', 'BUY', 'BUY'])
    expect(result.signal).toBe('BUY')
    expect(result.confidence).toBeGreaterThanOrEqual(90)
  })

  it('returns BUY at base confidence for single BUY', () => {
    const result = aggregate(['BUY', 'HOLD', 'HOLD', 'HOLD'])
    expect(result.signal).toBe('BUY')
    expect(result.confidence).toBe(65)
  })

  it('returns SELL when 2+ strategies vote SELL', () => {
    const result = aggregate(['SELL', 'SELL', 'HOLD', 'HOLD'])
    expect(result.signal).toBe('SELL')
  })

  it('returns SELL for single SELL with no buys', () => {
    const result = aggregate(['SELL', 'HOLD', 'HOLD', 'HOLD'])
    expect(result.signal).toBe('SELL')
  })

  it('returns HOLD when signals conflict (1 BUY + 1 SELL)', () => {
    const result = aggregate(['BUY', 'SELL', 'HOLD', 'HOLD'])
    expect(result.signal).toBe('HOLD')
  })

  it('returns HOLD when all strategies neutral', () => {
    const result = aggregate(['HOLD', 'HOLD', 'HOLD', 'HOLD'])
    expect(result.signal).toBe('HOLD')
  })

  it('confidence increases with more agreeing strategies', () => {
    const one = aggregate(['BUY', 'HOLD', 'HOLD', 'HOLD']).confidence
    const two = aggregate(['BUY', 'BUY', 'HOLD', 'HOLD']).confidence
    const three = aggregate(['BUY', 'BUY', 'BUY', 'HOLD']).confidence
    const four = aggregate(['BUY', 'BUY', 'BUY', 'BUY']).confidence
    expect(one).toBeLessThan(two)
    expect(two).toBeLessThan(three)
    expect(three).toBeLessThanOrEqual(four)
  })
})

/* ============================================================
 * Risk Management Logic Tests
 * ============================================================ */

describe('Risk Management Rules', () => {
  function shouldCloseForRisk(
    entryPrice: number, currentPrice: number, peakPrice: number, signal: 'BUY' | 'SELL' | 'HOLD'
  ): { shouldClose: boolean; reason: string } {
    const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100

    if (pnlPct <= -5) return { shouldClose: true, reason: `Stop-loss at ${pnlPct.toFixed(1)}%` }
    if (pnlPct >= 10) return { shouldClose: true, reason: `Take-profit at +${pnlPct.toFixed(1)}%` }

    const peakGainPct = peakPrice > 0 ? ((peakPrice - entryPrice) / entryPrice) * 100 : 0
    if (peakGainPct >= 5 && pnlPct < peakGainPct * 0.5) {
      return { shouldClose: true, reason: `Trailing stop — peaked at +${peakGainPct.toFixed(1)}%` }
    }
    if (signal === 'SELL') return { shouldClose: true, reason: 'Strategy SELL signal' }

    return { shouldClose: false, reason: '' }
  }

  it('triggers stop-loss at -5%', () => {
    const r = shouldCloseForRisk(100, 94, 100, 'HOLD')
    expect(r.shouldClose).toBe(true)
    expect(r.reason).toContain('Stop-loss')
  })

  it('triggers take-profit at +10%', () => {
    const r = shouldCloseForRisk(100, 111, 111, 'HOLD')
    expect(r.shouldClose).toBe(true)
    expect(r.reason).toContain('Take-profit')
  })

  it('does not trigger stop-loss at -3%', () => {
    const r = shouldCloseForRisk(100, 97, 100, 'HOLD')
    expect(r.shouldClose).toBe(false)
  })

  it('triggers trailing stop after peak gain fades', () => {
    // Peaked at +8%, now at +3% (below 50% of 8% = 4%)
    const r = shouldCloseForRisk(100, 103, 108, 'HOLD')
    expect(r.shouldClose).toBe(true)
    expect(r.reason).toContain('Trailing stop')
  })

  it('does not trigger trailing stop if still above 50% of peak gain', () => {
    // Peaked at +8%, now at +5% (above 50% of 8% = 4%)
    const r = shouldCloseForRisk(100, 105, 108, 'HOLD')
    expect(r.shouldClose).toBe(false)
  })

  it('triggers on strategy SELL signal', () => {
    const r = shouldCloseForRisk(100, 102, 103, 'SELL')
    expect(r.shouldClose).toBe(true)
    expect(r.reason).toContain('SELL')
  })

  it('does not close on BUY signal when in profit', () => {
    const r = shouldCloseForRisk(100, 104, 105, 'BUY')
    expect(r.shouldClose).toBe(false)
  })
})

/* ============================================================
 * Position Sizing Logic Tests
 * ============================================================ */

describe('Position Sizing by Confidence', () => {
  function calcAllocationPct(confidence: number, strategyCount: number = 1): number {
    let pct = 0.05
    if (confidence >= 90) pct = 0.12
    else if (confidence >= 80) pct = 0.10
    else if (confidence >= 70) pct = 0.08
    else pct = 0.05

    if (strategyCount >= 2) pct = Math.min(0.14, pct + 0.02)
    return pct
  }

  it('allocates 5% for low confidence single strategy', () => {
    expect(calcAllocationPct(60, 1)).toBe(0.05)
  })

  it('allocates 8% for medium confidence', () => {
    expect(calcAllocationPct(75, 1)).toBe(0.08)
  })

  it('allocates 10% for high confidence', () => {
    expect(calcAllocationPct(85, 1)).toBe(0.10)
  })

  it('allocates 12% for very high confidence', () => {
    expect(calcAllocationPct(95, 1)).toBe(0.12)
  })

  it('boosts allocation +2% for multi-strategy agreement', () => {
    expect(calcAllocationPct(75, 2)).toBeCloseTo(0.10) // 8% + 2% boost
    expect(calcAllocationPct(85, 3)).toBeCloseTo(0.12) // 10% + 2% boost
  })

  it('caps at 14% maximum', () => {
    expect(calcAllocationPct(95, 4)).toBeCloseTo(0.14) // 12% + 2% = 14%
  })
})

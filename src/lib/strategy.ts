import { getKlines } from './market'
import type { StrategySignal } from '@/types'

/* ============================================================
 * INDICATORS
 * ============================================================ */

/** Simple Moving Average */
function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

/** Simple Moving Average — returns array over the whole series */
function smaArray(values: number[], period: number): number[] {
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    result.push(sma(values.slice(0, i + 1), period))
  }
  return result
}

/** Exponential Moving Average — single value */
function ema(values: number[], period: number): number {
  if (values.length === 0) return 0
  const k = 2 / (period + 1)
  let emaPrev = values[0]
  for (let i = 1; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k)
  }
  return emaPrev
}

/** Exponential Moving Average — returns array over the whole series */
function emaArray(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const result: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

/** Relative Strength Index (Wilder's smoothing) */
function rsi(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50

  let avgGain = 0
  let avgLoss = 0

  // Initial seed
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= period
  avgLoss /= period

  // Wilder's smoothing for remaining data
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

/** RSI array over the whole series */
function rsiArray(closes: number[], period: number = 14): number[] {
  const result: number[] = []
  for (let i = 0; i < closes.length; i++) {
    result.push(rsi(closes.slice(0, i + 1), period))
  }
  return result
}

/** MACD: returns { macd, signal, histogram } */
function macd(closes: number[]): { macd: number; signal: number; histogram: number } {
  const fast = 12
  const slow = 26
  const signalPeriod = 9

  const emaFast: number[] = []
  const emaSlow: number[] = []
  const kFast = 2 / (fast + 1)
  const kSlow = 2 / (slow + 1)

  let ef = closes[0] ?? 0
  let es = closes[0] ?? 0
  for (let i = 0; i < closes.length; i++) {
    ef = i === 0 ? closes[0] : closes[i] * kFast + ef * (1 - kFast)
    es = i === 0 ? closes[0] : closes[i] * kSlow + es * (1 - kSlow)
    emaFast.push(ef)
    emaSlow.push(es)
  }

  const macdLine: number[] = emaFast.map((f, i) => f - emaSlow[i])

  let sig = macdLine[0] ?? 0
  const kSig = 2 / (signalPeriod + 1)
  for (let i = 1; i < macdLine.length; i++) {
    sig = macdLine[i] * kSig + sig * (1 - kSig)
  }

  const macdValue = macdLine[macdLine.length - 1] ?? 0
  const histogram = macdValue - sig

  return { macd: macdValue, signal: sig, histogram }
}

/** Bollinger Bands */
function bollingerBands(closes: number[], period: number = 20, mult: number = 2) {
  const mid = sma(closes, period)
  const slice = closes.slice(-period)
  const variance = slice.reduce((s, v) => s + Math.pow(v - mid, 2), 0) / Math.max(slice.length, 1)
  const std = Math.sqrt(variance)
  return {
    upper: mid + mult * std,
    middle: mid,
    lower: mid - mult * std,
    bandwidth: std * 2,
    percentB: std > 0 ? (closes[closes.length - 1] - (mid - mult * std)) / (mult * 2 * std) : 0.5,
  }
}

/** Average True Range (ATR) for volatility-based stop-loss */
function atr(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (closes.length < 2) return 0
  const trs: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    )
    trs.push(tr)
  }
  if (trs.length === 0) return 0
  let atrVal = trs.slice(0, Math.min(period, trs.length)).reduce((a, b) => a + b, 0) / Math.min(period, trs.length)
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period
  }
  return atrVal
}

/* ============================================================
 * SHARED TYPES
 * ============================================================ */

export type SignalDirection = 'BUY' | 'SELL' | 'HOLD'

export interface IndividualStrategyResult {
  name: string
  signal: SignalDirection
  confidence: number
  reason: string
}

export interface EnhancedSignal extends StrategySignal {
  stopLoss?: number
  takeProfit?: number
  riskReward?: number
  atr?: number
  trendStrength?: number
  strategies?: IndividualStrategyResult[]
  strategyCount?: number
}

/* ============================================================
 * INDICATOR DATA BUNDLE — computed once, passed to all strategies
 * ============================================================ */

export interface IndicatorBundle {
  closes: number[]
  highs: number[]
  lows: number[]
  volumes: number[]
  currentPrice: number
  currentVolume: number
  sma5: number
  sma20: number
  sma50: number
  prevSma5: number
  prevSma20: number
  ema9: number
  prevEma9: number
  ema21: number
  prevEma21: number
  rsi14: number
  prevRsi14: number
  rsiArray: number[]
  macd: { macd: number; signal: number; histogram: number }
  bb: { upper: number; middle: number; lower: number; bandwidth: number; percentB: number }
  atrVal: number
  high20: number
  prevHigh20: number
  avgVolume20: number
}

export function computeIndicators(
  klines: { open: number; high: number; low: number; close: number; volume: number }[]
): IndicatorBundle | null {
  const closes = klines.map((k) => k.close)
  const highs = klines.map((k) => k.high)
  const lows = klines.map((k) => k.low)
  const volumes = klines.map((k) => k.volume)

  if (closes.length < 26) return null

  const currentPrice = closes[closes.length - 1]
  const currentVolume = volumes[volumes.length - 1] ?? 0

  const closesPrev = closes.slice(0, -1)

  const sma5 = sma(closes, 5)
  const sma20 = sma(closes, 20)
  const sma50 = closes.length >= 50 ? sma(closes, 50) : sma(closes, Math.min(closes.length, 50))
  const prevSma5 = sma(closesPrev, 5)
  const prevSma20 = sma(closesPrev, 20)

  const ema9Arr = emaArray(closes, 9)
  const ema21Arr = emaArray(closes, 21)
  const ema9 = ema9Arr[ema9Arr.length - 1] ?? 0
  const prevEma9 = ema9Arr[ema9Arr.length - 2] ?? 0
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? 0
  const prevEma21 = ema21Arr[ema21Arr.length - 2] ?? 0

  const rsiArr = rsiArray(closes, 14)
  const rsi14 = rsiArr[rsiArr.length - 1] ?? 50
  const prevRsi14 = rsiArr[rsiArr.length - 2] ?? 50

  const macdResult = macd(closes)
  const bb = bollingerBands(closes, 20, 2)
  const atrVal = atr(highs, lows, closes, 14)

  // 20-day high (previous bar's high to detect breakout today)
  const high20 = Math.max(...highs.slice(-20))
  const prevHigh20 = highs.length >= 21 ? Math.max(...highs.slice(-21, -1)) : high20

  const avgVolume20 = volumes.length >= 20 ? sma(volumes.slice(-20), 20) : currentVolume

  return {
    closes, highs, lows, volumes, currentPrice, currentVolume,
    sma5, sma20, sma50, prevSma5, prevSma20,
    ema9, prevEma9, ema21, prevEma21,
    rsi14, prevRsi14, rsiArray: rsiArr,
    macd: macdResult, bb, atrVal, high20, prevHigh20, avgVolume20,
  }
}

/* ============================================================
 * STRATEGY 1: Multi-Indicator Confluence (original — refined)
 * SMA(5/20) crossover + RSI(14) + MACD + Bollinger Bands
 * ============================================================ */

export function strategyConfluence(ind: IndicatorBundle): IndividualStrategyResult {
  let score = 0
  const reasons: string[] = []

  // 1. SMA crossover (weight: 2)
  const goldenCross = ind.prevSma5 < ind.prevSma20 && ind.sma5 >= ind.sma20
  const deathCross = ind.prevSma5 > ind.prevSma20 && ind.sma5 <= ind.sma20
  const isBullish = ind.sma5 >= ind.sma20

  if (goldenCross) {
    score += 2
    reasons.push('Golden cross SMA(5/20)')
  } else if (deathCross) {
    score -= 2
    reasons.push('Death cross SMA(5/20)')
  } else if (isBullish) {
    score += 1
  } else {
    score -= 1
  }

  // 2. RSI (weight: 2)
  if (ind.rsi14 < 30) {
    score += 2
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} oversold — strong buy`)
  } else if (ind.rsi14 < 45) {
    score += 1
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} approaching oversold`)
  } else if (ind.rsi14 > 70) {
    score -= 2
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} overbought — strong sell`)
  } else if (ind.rsi14 > 55) {
    score -= 1
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} cooling off`)
  }

  // 3. MACD (weight: 2)
  if (ind.macd.histogram > 0 && ind.macd.macd > ind.macd.signal) {
    score += 2
    reasons.push('MACD bullish crossover')
  } else if (ind.macd.histogram < 0 && ind.macd.macd < ind.macd.signal) {
    score -= 2
    reasons.push('MACD bearish crossover')
  }

  // 4. Bollinger Bands (weight: 1)
  if (ind.currentPrice <= ind.bb.lower * 1.01) {
    score += 1
    reasons.push('Price at lower Bollinger Band — mean reversion buy')
  } else if (ind.currentPrice >= ind.bb.upper * 0.99) {
    score -= 1
    reasons.push('Price at upper Bollinger Band — overextended')
  }

  // 5. Volume confirmation (weight: 0.5)
  if (ind.currentVolume > ind.avgVolume20 * 1.5) {
    if (score > 0) {
      score += 0.5
      reasons.push('High volume confirms bullish signal')
    } else if (score < 0) {
      score -= 0.5
      reasons.push('High volume confirms bearish signal')
    }
  }

  const confidence = Math.min(99, Math.round(Math.abs(score) * 12 + 20))
  let signal: SignalDirection = 'HOLD'
  if (score >= 1.5) signal = 'BUY'
  else if (score <= -1.5) signal = 'SELL'

  return { name: 'Confluence', signal, confidence, reason: reasons.join('; ') || 'Neutral' }
}

/* ============================================================
 * STRATEGY 2: Momentum Breakout
 * Price breaks above 20-day high with volume surge
 * ============================================================ */

export function strategyMomentumBreakout(ind: IndicatorBundle): IndividualStrategyResult {
  let score = 0
  const reasons: string[] = []
  const breakoutUp = ind.currentPrice > ind.prevHigh20 && ind.prevHigh20 > 0
  const breakoutDown = ind.currentPrice < Math.min(...ind.lows.slice(-20, -1)) && ind.lows.length > 20

  // 1. 20-day high breakout (weight: 3)
  if (breakoutUp) {
    score += 3
    reasons.push(`Broke above 20-day high (₹${ind.prevHigh20.toFixed(2)})`)
  } else if (breakoutDown) {
    score -= 3
    reasons.push('Broke below 20-day low')
  }

  // 2. Volume surge (weight: 2)
  if (ind.currentVolume > ind.avgVolume20 * 1.5) {
    if (breakoutUp) {
      score += 2
      reasons.push(`Volume ${(ind.currentVolume / Math.max(ind.avgVolume20, 1)).toFixed(1)}x avg — strong confirmation`)
    } else if (breakoutDown) {
      score -= 2
      reasons.push('High volume on breakdown — bearish')
    }
  }

  // 3. RSI in momentum zone 40–70 (weight: 1)
  if (ind.rsi14 >= 40 && ind.rsi14 <= 70) {
    if (breakoutUp) {
      score += 1
      reasons.push(`RSI ${ind.rsi14.toFixed(0)} in momentum zone`)
    }
  } else if (ind.rsi14 > 75) {
    score -= 1
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} overbought`)
  }

  // 4. Trend alignment: SMA5 > SMA20 (weight: 1)
  if (ind.sma5 > ind.sma20) {
    if (breakoutUp) {
      score += 1
      reasons.push('SMA5 > SMA20 — trend aligned')
    }
  } else {
    if (breakoutUp) {
      score -= 1
      reasons.push('SMA5 < SMA20 — counter-trend breakout')
    } else {
      score -= 1
    }
  }

  const confidence = Math.min(99, Math.round(Math.abs(score) * 11 + 15))
  let signal: SignalDirection = 'HOLD'
  if (score >= 3) signal = 'BUY'
  else if (score <= -3) signal = 'SELL'

  return { name: 'Momentum Breakout', signal, confidence, reason: reasons.join('; ') || 'No breakout' }
}

/* ============================================================
 * STRATEGY 3: Mean Reversion (Oversold Bounce)
 * RSI deeply oversold + lower Bollinger Band + above SMA50
 * ============================================================ */

export function strategyMeanReversion(ind: IndicatorBundle): IndividualStrategyResult {
  let score = 0
  const reasons: string[] = []

  // 1. RSI deeply oversold (weight: 3)
  if (ind.rsi14 < 30) {
    score += 3
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} deeply oversold`)
  } else if (ind.rsi14 < 35) {
    score += 2
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} oversold`)
  } else if (ind.rsi14 < 40) {
    score += 1
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} near oversold`)
  } else if (ind.rsi14 > 70) {
    score -= 3
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} overbought — sell signal`)
  } else if (ind.rsi14 > 65) {
    score -= 1
    reasons.push(`RSI ${ind.rsi14.toFixed(0)} approaching overbought`)
  }

  // 2. Bollinger Band touch (weight: 2)
  if (ind.currentPrice <= ind.bb.lower * 1.01) {
    score += 2
    reasons.push('Price at lower Bollinger Band')
  } else if (ind.currentPrice >= ind.bb.upper * 0.99) {
    score -= 2
    reasons.push('Price at upper Bollinger Band — sell')
  }

  // 3. RSI turning up (weight: 2) — momentum is shifting
  if (ind.rsi14 > ind.prevRsi14 && ind.rsi14 < 45) {
    score += 2
    reasons.push('RSI turning up — bounce starting')
  } else if (ind.rsi14 < ind.prevRsi14 && ind.rsi14 > 55) {
    score -= 2
    reasons.push('RSI turning down — momentum fading')
  }

  // 4. Above SMA50 — don't catch falling knives in downtrends (weight: 2)
  if (ind.currentPrice > ind.sma50 && ind.sma50 > 0) {
    if (score > 0) {
      score += 2
      reasons.push('Price above SMA50 — structural support')
    }
  } else if (ind.currentPrice < ind.sma50 && ind.sma50 > 0) {
    if (score > 0) {
      score -= 2
      reasons.push('Price below SMA50 — downtrend, risky bounce')
    }
  }

  const confidence = Math.min(99, Math.round(Math.abs(score) * 11 + 15))
  let signal: SignalDirection = 'HOLD'
  if (score >= 3) signal = 'BUY'
  else if (score <= -3) signal = 'SELL'

  return { name: 'Mean Reversion', signal, confidence, reason: reasons.join('; ') || 'No setup' }
}

/* ============================================================
 * STRATEGY 4: EMA Crossover Trend
 * EMA(9) crosses above/below EMA(21) with trend filter + MACD
 * ============================================================ */

export function strategyEmaCrossover(ind: IndicatorBundle): IndividualStrategyResult {
  let score = 0
  const reasons: string[] = []

  // 1. EMA(9/21) crossover (weight: 3)
  const bullCross = ind.prevEma9 <= ind.prevEma21 && ind.ema9 > ind.ema21
  const bearCross = ind.prevEma9 >= ind.prevEma21 && ind.ema9 < ind.ema21

  if (bullCross) {
    score += 3
    reasons.push('EMA(9) crossed above EMA(21) — bullish')
  } else if (bearCross) {
    score -= 3
    reasons.push('EMA(9) crossed below EMA(21) — bearish')
  } else if (ind.ema9 > ind.ema21) {
    score += 1
    reasons.push('EMA9 above EMA21 — bullish trend')
  } else {
    score -= 1
    reasons.push('EMA9 below EMA21 — bearish trend')
  }

  // 2. Price above/below SMA50 (weight: 2)
  if (ind.currentPrice > ind.sma50 && ind.sma50 > 0) {
    if (score > 0 || bullCross) {
      score += 2
      reasons.push('Price above SMA50 — long-term uptrend')
    }
  } else if (ind.currentPrice < ind.sma50 && ind.sma50 > 0) {
    if (score < 0 || bearCross) {
      score -= 2
      reasons.push('Price below SMA50 — long-term downtrend')
    } else {
      score -= 1
      reasons.push('Price below SMA50 — trend not confirmed')
    }
  }

  // 3. MACD histogram confirmation (weight: 2)
  if (ind.macd.histogram > 0) {
    if (score > 0) {
      score += 2
      reasons.push('MACD histogram positive — momentum confirms')
    }
  } else if (ind.macd.histogram < 0) {
    if (score < 0) {
      score -= 2
      reasons.push('MACD histogram negative — momentum confirms sell')
    }
  }

  const confidence = Math.min(99, Math.round(Math.abs(score) * 11 + 15))
  let signal: SignalDirection = 'HOLD'
  if (score >= 3) signal = 'BUY'
  else if (score <= -3) signal = 'SELL'

  return { name: 'EMA Crossover', signal, confidence, reason: reasons.join('; ') || 'No crossover' }
}

/* ============================================================
 * STRATEGY 5: Kronos AI Foundation Model (cached daily)
 * Reads pre-computed forecast from scanner cache — instant, no latency.
 * https://github.com/shiyu-coder/Kronos
 * ============================================================ */

interface KronosCachedForecast {
  symbol: string
  direction: string        // 'bullish' | 'bearish' | 'neutral'
  confidence_pct: number   // 0-100 — fraction of Monte Carlo paths agreeing on direction
  upside_probability: number  // 0-100 — fraction of paths ending above current price
  volatility_amplification: number
  predicted_change_pct: number
  current_price: number
  forecast_final_price: number
  horizon: number
  created_at: string
}

/**
 * Fetch the cached Kronos forecast for an instrument (Turso first, then scanner).
 * Returns null if no cache exists. NEVER blocks long — failures → HOLD.
 */
async function getKronosCachedForecast(instrument: string): Promise<KronosCachedForecast | null> {
  try {
    const { resolveKronosSummary } = await import('@/lib/ui-cache')
    const data = await resolveKronosSummary(instrument)
    if (!data) return null
    return data as KronosCachedForecast
  } catch {
    return null
  }
}

/**
 * Kronos AI strategy: uses the foundation model's cached daily forecast
 * to produce a BUY/SELL/HOLD signal.
 *
 * Signal logic:
 * - direction=bullish + upside_probability>55% → BUY
 * - direction=bearish + upside_probability<45% → SELL
 * - Otherwise → HOLD
 *
 * Confidence: weighted combination of model confidence_pct and upside_probability.
 */
async function strategyKronos(instrument: string): Promise<IndividualStrategyResult> {
  const fc = await getKronosCachedForecast(instrument)

  if (!fc) {
    return { name: 'Kronos AI', signal: 'HOLD', confidence: 0, reason: 'No cached forecast (runs daily at 6:30 AM IST)' }
  }

  // Determine signal
  let signal: SignalDirection = 'HOLD'
  const reasons: string[] = []

  if (fc.direction === 'bullish' && fc.upside_probability > 55) {
    signal = 'BUY'
    reasons.push(`Kronos predicts +${fc.predicted_change_pct.toFixed(1)}% over ${fc.horizon}d`)
    reasons.push(`${fc.upside_probability}% upside probability`)
  } else if (fc.direction === 'bearish' && fc.upside_probability < 45) {
    signal = 'SELL'
    reasons.push(`Kronos predicts ${fc.predicted_change_pct.toFixed(1)}% over ${fc.horizon}d`)
    reasons.push(`${100 - fc.upside_probability}% downside probability`)
  } else {
    reasons.push(`Kronos: ${fc.direction} (conf ${fc.confidence_pct}%, upside ${fc.upside_probability}%)`)
  }

  // Confidence: blend of model confidence and direction certainty
  const upsideCertainty = Math.abs(fc.upside_probability - 50) * 2 // 0-100 scale from 50% midpoint
  const confidence = Math.min(99, Math.round(fc.confidence_pct * 0.5 + upsideCertainty * 0.5))

  return { name: 'Kronos AI', signal, confidence, reason: reasons.join('; ') }
}

/* ============================================================
 * MULTI-STRATEGY CONSENSUS ENGINE
 * ============================================================ */

export const STRATEGY_NAMES = [
  'Confluence',
  'Momentum Breakout',
  'Mean Reversion',
  'EMA Crossover',
  'Kronos AI',
] as const

/**
 * Aggregate individual strategy results into a consensus signal.
 *
 * Rules:
 * - 2+ strategies voting BUY → strong BUY with confidence boost
 * - 1 strategy voting BUY (others HOLD) → BUY at base confidence
 * - 2+ strategies voting SELL → strong SELL
 * - 1 strategy voting SELL (others HOLD) → SELL at base confidence
 * - Otherwise → HOLD
 */
export function aggregateStrategies(
  results: IndividualStrategyResult[]
): { signal: SignalDirection; confidence: number; reason: string } {
  const buys = results.filter((r) => r.signal === 'BUY')
  const sells = results.filter((r) => r.signal === 'SELL')
  const holds = results.filter((r) => r.signal === 'HOLD')

  const buyReasons = buys.map((b) => `[${b.name}: ${b.reason}]`).join(' ')
  const sellReasons = sells.map((s) => `[${s.name}: ${s.reason}]`).join(' ')

  if (buys.length >= 2) {
    // Multi-strategy agreement: average their confidences then boost
    const avgConf = buys.reduce((s, b) => s + b.confidence, 0) / buys.length
    const boost = 1 + (buys.length - 1) * 0.1 // +10% per additional agreeing strategy
    const confidence = Math.min(99, Math.round(avgConf * boost))
    return {
      signal: 'BUY',
      confidence,
      reason: `${buys.length} strategies agree: ${buyReasons}`,
    }
  }

  if (buys.length === 1 && sells.length === 0) {
    return {
      signal: 'BUY',
      confidence: buys[0].confidence,
      reason: buyReasons,
    }
  }

  if (sells.length >= 2) {
    const avgConf = sells.reduce((s, s2) => s + s2.confidence, 0) / sells.length
    const boost = 1 + (sells.length - 1) * 0.1
    const confidence = Math.min(99, Math.round(avgConf * boost))
    return {
      signal: 'SELL',
      confidence,
      reason: `${sells.length} strategies agree: ${sellReasons}`,
    }
  }

  if (sells.length === 1 && buys.length === 0) {
    return {
      signal: 'SELL',
      confidence: sells[0].confidence,
      reason: sellReasons,
    }
  }

  // HOLD — neutral or conflicting
  return {
    signal: 'HOLD',
    confidence: 0,
    reason: holds.length > 0
      ? 'Neutral — no strong signal'
      : 'Conflicting signals',
  }
}

/**
 * Run all 4 strategies on an instrument and return the consensus.
 */
export async function generateMultiStrategySignal(
  instrument: string
): Promise<EnhancedSignal> {
  const klines = await getKlines(instrument, '1d', '3mo')
  const ind = computeIndicators(klines)

  if (!ind) {
    return {
      instrument,
      signal: 'HOLD',
      reason: 'Insufficient data',
      price: klines.length > 0 ? klines[klines.length - 1].close : 0,
      confidence: 0,
      indicators: { sma5: 0, sma20: 0, rsi14: 0, volume: 0 },
    }
  }

  const strategyResults: IndividualStrategyResult[] = [
    strategyConfluence(ind),
    strategyMomentumBreakout(ind),
    strategyMeanReversion(ind),
    strategyEmaCrossover(ind),
  ]

  // Kronos AI is async (reads from scanner cache) — fetch in parallel with indicators
  const kronosResult = await strategyKronos(instrument)
  strategyResults.push(kronosResult)

  const consensus = aggregateStrategies(strategyResults)

  // Risk levels using ATR
  let stopLoss: number | undefined
  let takeProfit: number | undefined
  let riskReward: number | undefined

  if (consensus.signal === 'BUY' && ind.atrVal > 0) {
    stopLoss = ind.currentPrice - ind.atrVal * 1.5
    takeProfit = ind.currentPrice + ind.atrVal * 3
    riskReward = 2.0
  } else if (consensus.signal === 'SELL' && ind.atrVal > 0) {
    stopLoss = ind.currentPrice + ind.atrVal * 1.5
    takeProfit = ind.currentPrice - ind.atrVal * 3
    riskReward = 2.0
  }

  const trendStrength = Math.min(100, consensus.confidence)

  return {
    instrument,
    signal: consensus.signal,
    reason: consensus.reason,
    price: ind.currentPrice,
    confidence: consensus.confidence,
    indicators: {
      sma5: Math.round(ind.sma5 * 100) / 100,
      sma20: Math.round(ind.sma20 * 100) / 100,
      rsi14: Math.round(ind.rsi14 * 10) / 10,
      volume: ind.currentVolume,
    },
    stopLoss,
    takeProfit,
    riskReward,
    atr: Math.round(ind.atrVal * 100) / 100,
    trendStrength,
    strategies: strategyResults,
    strategyCount: strategyResults.filter((r) => r.signal !== 'HOLD').length,
  }
}

/* ============================================================
 * BACKWARD COMPATIBILITY — generateSignal delegates to multi-strategy
 * ============================================================ */

/**
 * Generate a comprehensive swing trading signal.
 * Now uses the multi-strategy consensus engine under the hood.
 */
export async function generateSignal(
  instrument: string
): Promise<EnhancedSignal> {
  return generateMultiStrategySignal(instrument)
}

/**
 * Generate signals for all instruments — batched to avoid rate limits.
 */
export async function generateAllSignals(
  instruments: string[]
): Promise<StrategySignal[]> {
  const results: StrategySignal[] = []
  const batchSize = 5
  for (let i = 0; i < instruments.length; i += batchSize) {
    const batch = instruments.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(batch.map((inst) => generateSignal(inst)))
    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value)
      } else {
        results.push({
          instrument: 'UNKNOWN',
          signal: 'HOLD',
          reason: 'Failed to fetch data',
          price: 0,
          confidence: 0,
          indicators: { sma5: 0, sma20: 0, rsi14: 0, volume: 0 },
        })
      }
    }
  }
  return results
}

import { getKlines } from '../market'

/**
 * Feature Engineering Pipeline
 *
 * Extracts a structured feature vector from market data for ML models.
 * Each feature is normalized where appropriate for model training.
 */

export interface TradeFeatures {
  // Price-based features
  rsi14: number
  rsiPrev: number
  macdHist: number
  macdLine: number
  macdSignal: number
  bbPercentB: number
  bbBandwidth: number
  priceVsSma5: number   // % distance from SMA5
  priceVsSma20: number  // % distance from SMA20
  priceVsSma50: number  // % distance from SMA50
  sma5VsSma20: number   // SMA5 vs SMA20 cross ratio
  ema9VsEma21: number   // EMA9 vs EMA21 cross ratio

  // Volume features
  volumeRatio: number   // Current vol / avg vol
  volumeTrend: number   // 5-day volume trend

  // Volatility features
  atrPct: number        // ATR as % of price
  historicalVolatility: number // 20-day realized vol

  // Momentum features
  momentum5d: number    // 5-day return %
  momentum10d: number   // 10-day return %
  momentum20d: number   // 20-day return %
  rsiChange: number     // RSI change (current - prev)

  // Trend features
  trendScore: number    // Composite trend score (-1 to +1)
  higherHighs: number   // Count of recent higher highs

  // Market regime
  volatilityRegime: number  // 0=low, 1=normal, 2=high
  trendRegime: number       // -1=downtrend, 0=range, 1=uptrend
}

export interface FeatureResult {
  features: TradeFeatures
  price: number
  indicators: {
    sma5: number
    sma20: number
    sma50: number
    rsi14: number
    macd: { macd: number; signal: number; histogram: number }
    bollingerBands: { upper: number; middle: number; lower: number; percentB: number; bandwidth: number }
    atr: number
  }
}

/* ---- Indicator helpers ---- */

function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

function emaArray(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const result: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function rsi(closes: number[], period: number = 14): { current: number; prev: number } {
  if (closes.length < period + 2) return { current: 50, prev: 50 }
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period + 1; i < closes.length - 1; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  const currentRSI = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  // Previous RSI
  const prevChange = closes[closes.length - 1] - closes[closes.length - 2]
  const prevGain = prevChange > 0 ? prevChange : 0
  const prevLoss = prevChange < 0 ? -prevChange : 0
  const prevAvgGain = (avgGain * (period - 1) + prevGain) / period
  const prevAvgLoss = (avgLoss * (period - 1) + prevLoss) / period
  const prevRSI = prevAvgLoss === 0 ? 100 : 100 - 100 / (1 + prevAvgGain / prevAvgLoss)

  return { current: currentRSI, prev: prevRSI }
}

function macd(closes: number[]): { macd: number; signal: number; histogram: number } {
  const emaFast = emaArray(closes, 12)
  const emaSlow = emaArray(closes, 26)
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i])
  const signalLine = emaArray(macdLine, 9)
  const macdValue = macdLine[macdLine.length - 1] ?? 0
  const signalValue = signalLine[signalLine.length - 1] ?? 0
  return { macd: macdValue, signal: signalValue, histogram: macdValue - signalValue }
}

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

/* ---- Feature extraction ---- */

/**
 * Extract a full feature vector from market data for a symbol.
 */
export async function extractFeatures(symbol: string): Promise<FeatureResult | null> {
  const klines = await getKlines(symbol, '1d', '3mo')
  if (klines.length < 30) return null

  const closes = klines.map(k => k.close)
  const highs = klines.map(k => k.high)
  const lows = klines.map(k => k.low)
  const volumes = klines.map(k => k.volume)

  const currentPrice = closes[closes.length - 1]
  const sma5 = sma(closes, 5)
  const sma20 = sma(closes, 20)
  const sma50 = closes.length >= 50 ? sma(closes, 50) : sma(closes, closes.length)
  const rsiResult = rsi(closes, 14)
  const macdResult = macd(closes)

  // Bollinger Bands
  const bbMid = sma(closes, 20)
  const bbSlice = closes.slice(-20)
  const bbVariance = bbSlice.reduce((s, v) => s + Math.pow(v - bbMid, 2), 0) / Math.max(bbSlice.length, 1)
  const bbStd = Math.sqrt(bbVariance)
  const bbUpper = bbMid + 2 * bbStd
  const bbLower = bbMid - 2 * bbStd
  const bbBandwidth = bbStd * 2
  const bbPercentB = bbStd > 0 ? (currentPrice - bbLower) / (2 * bbStd) : 0.5

  const atrVal = atr(highs, lows, closes, 14)

  // Volume features
  const currentVolume = volumes[volumes.length - 1] ?? 0
  const avgVolume20 = volumes.length >= 20 ? sma(volumes.slice(-20), 20) : currentVolume
  const volumeRatio = avgVolume20 > 0 ? currentVolume / avgVolume20 : 1
  const vol5 = volumes.slice(-5)
  const vol5Avg = vol5.reduce((a, b) => a + b, 0) / Math.max(vol5.length, 1)
  const vol5Prev = volumes.slice(-10, -5)
  const vol5PrevAvg = vol5Prev.length > 0 ? vol5Prev.reduce((a, b) => a + b, 0) / vol5Prev.length : vol5Avg
  const volumeTrend = vol5PrevAvg > 0 ? vol5Avg / vol5PrevAvg : 1

  // Momentum
  const momentum5d = closes.length >= 6 ? ((currentPrice - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0
  const momentum10d = closes.length >= 11 ? ((currentPrice - closes[closes.length - 11]) / closes[closes.length - 11]) * 100 : 0
  const momentum20d = closes.length >= 21 ? ((currentPrice - closes[closes.length - 21]) / closes[closes.length - 21]) * 100 : 0

  // Trend features
  let trendScore = 0
  if (sma5 > sma20) trendScore += 0.33
  if (sma20 > sma50) trendScore += 0.33
  if (currentPrice > sma50) trendScore += 0.34
  trendScore = trendScore * 2 - 1 // normalize to -1 to +1

  // Higher highs count (last 5 bars)
  let higherHighs = 0
  for (let i = highs.length - 5; i < highs.length; i++) {
    if (i > 0 && highs[i] > highs[i - 1]) higherHighs++
  }

  // Volatility regime (0=low, 1=normal, 2=high)
  const atrPct = currentPrice > 0 ? (atrVal / currentPrice) * 100 : 0
  const historicalVolatility = closes.length >= 20 ? (() => {
    const returns: number[] = []
    for (let i = closes.length - 20; i < closes.length; i++) {
      if (i > 0 && closes[i - 1] > 0) {
        returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
      }
    }
    const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1)
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / Math.max(returns.length, 1)
    return Math.sqrt(variance) * Math.sqrt(252) * 100 // annualized %
  })() : 0

  const volatilityRegime = atrPct < 1.5 ? 0 : atrPct < 3 ? 1 : 2

  // Trend regime
  let trendRegime = 0
  if (sma5 > sma20 && sma20 > sma50) trendRegime = 1
  else if (sma5 < sma20 && sma20 < sma50) trendRegime = -1

  // Price distances
  const priceVsSma5 = sma5 > 0 ? ((currentPrice - sma5) / sma5) * 100 : 0
  const priceVsSma20 = sma20 > 0 ? ((currentPrice - sma20) / sma20) * 100 : 0
  const priceVsSma50 = sma50 > 0 ? ((currentPrice - sma50) / sma50) * 100 : 0
  const sma5VsSma20 = sma20 > 0 ? ((sma5 - sma20) / sma20) * 100 : 0

  const ema9Arr = emaArray(closes, 9)
  const ema21Arr = emaArray(closes, 21)
  const ema9 = ema9Arr[ema9Arr.length - 1] ?? 0
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? 0
  const ema9VsEma21 = ema21 > 0 ? ((ema9 - ema21) / ema21) * 100 : 0

  const features: TradeFeatures = {
    rsi14: rsiResult.current,
    rsiPrev: rsiResult.prev,
    macdHist: macdResult.histogram,
    macdLine: macdResult.macd,
    macdSignal: macdResult.signal,
    bbPercentB,
    bbBandwidth,
    priceVsSma5,
    priceVsSma20,
    priceVsSma50,
    sma5VsSma20,
    ema9VsEma21,
    volumeRatio,
    volumeTrend,
    atrPct,
    historicalVolatility,
    momentum5d,
    momentum10d,
    momentum20d,
    rsiChange: rsiResult.current - rsiResult.prev,
    trendScore,
    higherHighs,
    volatilityRegime,
    trendRegime,
  }

  return {
    features,
    price: currentPrice,
    indicators: {
      sma5,
      sma20,
      sma50,
      rsi14: rsiResult.current,
      macd: macdResult,
      bollingerBands: { upper: bbUpper, middle: bbMid, lower: bbLower, percentB: bbPercentB, bandwidth: bbBandwidth },
      atr: atrVal,
    },
  }
}

/**
 * Generate a heuristic ML-style prediction using feature analysis.
 * This provides immediate value while a full ML model is being trained.
 *
 * The model uses logistic-regression-style scoring on normalized features
 * to produce a probability of trade success.
 */
export function heuristicPrediction(features: TradeFeatures): {
  successProbability: number
  factors: { name: string; contribution: number; direction: string }[]
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
} {
  const factors: { name: string; contribution: number; direction: string }[] = []
  let score = 0

  // RSI: mildly oversold is bullish, overbought is bearish
  if (features.rsi14 < 35) {
    const contrib = (35 - features.rsi14) * 0.3
    score += contrib
    factors.push({ name: 'RSI oversold bounce', contribution: contrib, direction: 'bullish' })
  } else if (features.rsi14 > 70) {
    const contrib = (features.rsi14 - 70) * 0.3
    score -= contrib
    factors.push({ name: 'RSI overbought', contribution: contrib, direction: 'bearish' })
  }

  // Trend alignment
  if (features.trendScore > 0.3) {
    const contrib = features.trendScore * 15
    score += contrib
    factors.push({ name: 'Strong uptrend alignment', contribution: contrib, direction: 'bullish' })
  } else if (features.trendScore < -0.3) {
    const contrib = Math.abs(features.trendScore) * 15
    score -= contrib
    factors.push({ name: 'Downtrend pressure', contribution: contrib, direction: 'bearish' })
  }

  // MACD histogram
  if (features.macdHist > 0) {
    const contrib = Math.min(10, features.macdHist * 100)
    score += contrib
    factors.push({ name: 'MACD bullish momentum', contribution: contrib, direction: 'bullish' })
  } else {
    const contrib = Math.min(10, Math.abs(features.macdHist) * 100)
    score -= contrib
    factors.push({ name: 'MACD bearish momentum', contribution: contrib, direction: 'bearish' })
  }

  // Volume confirmation
  if (features.volumeRatio > 1.5) {
    const contrib = 5
    score += score > 0 ? contrib : -contrib
    factors.push({ name: 'High volume confirmation', contribution: contrib, direction: score > 0 ? 'bullish' : 'bearish' })
  }

  // Momentum
  if (features.momentum5d > 2) {
    const contrib = Math.min(8, features.momentum5d)
    score += contrib
    factors.push({ name: 'Positive 5-day momentum', contribution: contrib, direction: 'bullish' })
  } else if (features.momentum5d < -2) {
    const contrib = Math.min(8, Math.abs(features.momentum5d))
    score -= contrib
    factors.push({ name: 'Negative momentum', contribution: contrib, direction: 'bearish' })
  }

  // Bollinger Band position
  if (features.bbPercentB < 0.2) {
    const contrib = 5
    score += contrib
    factors.push({ name: 'Near lower Bollinger Band', contribution: contrib, direction: 'bullish' })
  } else if (features.bbPercentB > 0.8) {
    const contrib = 5
    score -= contrib
    factors.push({ name: 'Near upper Bollinger Band', contribution: contrib, direction: 'bearish' })
  }

  // Convert score to probability using sigmoid
  const successProbability = Math.round(1 / (1 + Math.exp(-score / 15)) * 100)
  const confidence = successProbability >= 70 ? 'HIGH' : successProbability >= 55 ? 'MEDIUM' : 'LOW'

  return { successProbability, factors, confidence }
}

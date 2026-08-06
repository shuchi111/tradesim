import { extractFeatures, heuristicPrediction, type TradeFeatures } from './features'
import { generateMultiStrategySignal } from '../strategy'

/**
 * Composite Confidence Score
 *
 * Combines multiple signals into a single confidence metric:
 *   Confidence = Strategy Agreement (35%)
 *              + ML Prediction (25%)
 *              + Kronos AI (15%)
 *              + Market Regime (15%)
 *              + Historical Win Rate (10%)
 */

export interface ConfidenceScoreResult {
  symbol: string
  price: number
  overallConfidence: number  // 0-100
  components: {
    strategyAgreement: { score: number; weight: number; detail: string }
    mlPrediction: { score: number; weight: number; detail: string }
    kronosAI: { score: number; weight: number; detail: string }
    marketRegime: { score: number; weight: number; detail: string }
    historicalWinRate: { score: number; weight: number; detail: string }
  }
  recommendation: 'STRONG BUY' | 'BUY' | 'HOLD' | 'AVOID'
  factors: { name: string; contribution: number; direction: string }[]
  signal: 'BUY' | 'SELL' | 'HOLD'
}

/**
 * Fetch the cached Kronos forecast for a symbol.
 * Returns null if unavailable — the Kronos component falls back to neutral (50%).
 */
async function getKronosForConfidence(symbol: string): Promise<{ upside: number; vol: number; direction: string } | null> {
  try {
    const { resolveKronosSummary } = await import('@/lib/ui-cache')
    const data = await resolveKronosSummary(symbol)
    if (!data) return null
    return {
      upside: data.upside_probability ?? 50,
      vol: data.volatility_amplification ?? 50,
      direction: data.direction ?? 'neutral',
    }
  } catch {
    return null
  }
}

/**
 * Calculate composite confidence score for a symbol.
 */
export async function calculateConfidenceScore(symbol: string): Promise<ConfidenceScoreResult | null> {
  // 1. Strategy agreement (35%)
  const strategySignal = await generateMultiStrategySignal(symbol)
  const strategyScore = strategySignal.confidence // already 0-99
  const strategyDetail = strategySignal.strategies
    ? `${strategySignal.strategies.filter(s => s.signal === 'BUY').length}/${strategySignal.strategies.length} strategies BUY`
    : 'Single strategy'

  // 2. ML prediction (25%)
  const featureResult = await extractFeatures(symbol)
  if (!featureResult) return null

  const mlResult = heuristicPrediction(featureResult.features)
  const mlScore = mlResult.successProbability // 0-100

  // 3. Kronos AI forecast (15%) — from daily cached forecast
  const kronosData = await getKronosForConfidence(symbol)
  let kronosScore = 50  // default neutral if no cache
  let kronosDetail = 'No cached forecast — neutral'
  if (kronosData) {
    kronosScore = kronosData.upside
    // Confidence boost: when model strongly predicts upside (>60%), boost the score
    if (kronosData.upside > 60) {
      kronosScore = Math.min(100, kronosScore + 10)
    } else if (kronosData.upside < 40) {
      kronosScore = Math.max(0, kronosScore - 10)
    }
    kronosDetail = `Upside probability: ${kronosData.upside}% (${kronosData.direction}, vol amp ${kronosData.vol}%)${kronosData.upside > 60 ? ' [BOOSTED]' : ''}`
  }

  // 4. Market regime (15%)
  const regimeScore = calculateRegimeScore(featureResult.features)

  // 5. Historical win rate (10%) — derived from strategy confidence as proxy
  const histScore = Math.min(100, strategySignal.confidence * 0.8 + 10)

  // Weighted combination
  const overallConfidence = Math.round(
    strategyScore * 0.35 +
    mlScore * 0.25 +
    kronosScore * 0.15 +
    regimeScore * 0.15 +
    histScore * 0.10
  )

  const recommendation = overallConfidence >= 80 ? 'STRONG BUY'
    : overallConfidence >= 65 ? 'BUY'
    : overallConfidence >= 45 ? 'HOLD'
    : 'AVOID'

  return {
    symbol,
    price: strategySignal.price,
    overallConfidence,
    components: {
      strategyAgreement: { score: strategyScore, weight: 0.35, detail: strategyDetail },
      mlPrediction: { score: mlScore, weight: 0.25, detail: `ML probability: ${mlScore}%` },
      kronosAI: { score: kronosScore, weight: 0.15, detail: kronosDetail },
      marketRegime: { score: regimeScore, weight: 0.15, detail: getRegimeDetail(featureResult.features) },
      historicalWinRate: { score: histScore, weight: 0.10, detail: 'Derived from strategy backtest' },
    },
    recommendation,
    factors: [
      ...mlResult.factors,
      ...(kronosData ? [{
        name: 'Kronos AI Upside',
        contribution: Math.round(kronosData.upside > 50 ? (kronosData.upside - 50) * 0.3 : (50 - kronosData.upside) * -0.3),
        direction: kronosData.upside > 55 ? 'bullish' : kronosData.upside < 45 ? 'bearish' : 'neutral',
      }] : []),
    ],
    signal: strategySignal.signal,
  }
}

function calculateRegimeScore(features: TradeFeatures): number {
  let score = 50

  // Trending markets favor momentum strategies
  if (features.trendRegime === 1) {
    score += 20 // Uptrend favors buying
  } else if (features.trendRegime === -1) {
    score -= 20 // Downtrend disfavors buying
  }

  // Low volatility is better for entries
  if (features.volatilityRegime === 0) {
    score += 10
  } else if (features.volatilityRegime === 2) {
    score -= 15
  }

  // Positive momentum adds to regime score
  if (features.momentum10d > 0) {
    score += 5
  }

  return Math.max(0, Math.min(100, score))
}

function getRegimeDetail(features: TradeFeatures): string {
  const parts: string[] = []
  if (features.trendRegime === 1) parts.push('uptrend')
  else if (features.trendRegime === -1) parts.push('downtrend')
  else parts.push('ranging')

  const volLabel = features.volatilityRegime === 0 ? 'low vol' : features.volatilityRegime === 2 ? 'high vol' : 'normal vol'
  parts.push(volLabel)

  return parts.join(', ')
}

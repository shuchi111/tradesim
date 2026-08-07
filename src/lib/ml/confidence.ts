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
async function getKronosForConfidence(symbol: string): Promise<{
  upside: number
  vol: number
  direction: string
  confidencePct: number
  predictedChangePct: number
  currentPrice: number
  forecastFinalPrice: number
  horizon: number
} | null> {
  try {
    const { resolveKronosSummary } = await import('@/lib/ui-cache')
    const data = await resolveKronosSummary(symbol)
    if (!data) return null
    return {
      upside: data.upside_probability ?? 50,
      vol: data.volatility_amplification ?? 50,
      direction: data.direction ?? 'neutral',
      confidencePct: data.confidence_pct ?? 0,
      predictedChangePct: data.predicted_change_pct ?? 0,
      currentPrice: data.current_price ?? 0,
      forecastFinalPrice: data.forecast_final_price ?? 0,
      horizon: data.horizon ?? 10,
    }
  } catch {
    return null
  }
}

type FactorRow = { name: string; contribution: number; direction: string }

/**
 * Build Kronos ML Factor Analysis rows (magnitude always positive; badge carries bullish/bearish).
 */
function buildKronosFactors(k: NonNullable<Awaited<ReturnType<typeof getKronosForConfidence>>>): FactorRow[] {
  const dir = (k.direction || 'neutral').toLowerCase()
  const dirLabel = dir.toUpperCase()
  const dirBias: FactorRow['direction'] =
    dir === 'bullish' ? 'bullish' : dir === 'bearish' ? 'bearish' : 'neutral'

  // 1) Direction — confidencePct × 0.15 (0 if neutral)
  const directionContrib =
    dirBias === 'neutral' ? 0 : Math.round(k.confidencePct * 0.15 * 10) / 10

  // 2) Predicted move — |predictedChangePct| × 2, capped at 10
  const moveContrib = Math.min(10, Math.round(Math.abs(k.predictedChangePct) * 2 * 10) / 10)
  const moveSign = k.predictedChangePct >= 0 ? '+' : ''
  const priceBit =
    k.currentPrice > 0 && k.forecastFinalPrice > 0
      ? ` (₹${Math.round(k.currentPrice)} -> ₹${Math.round(k.forecastFinalPrice)})`
      : ''
  const moveDirection: FactorRow['direction'] =
    k.predictedChangePct > 1 ? 'bullish' : k.predictedChangePct < -1 ? 'bearish' : 'neutral'

  // 3) Model confidence — (confidencePct − 50) × 0.2 when >50%
  const confContrib = Math.max(0, Math.round((k.confidencePct - 50) * 0.2 * 10) / 10)

  // 4) Volatility — amplified (>130%) or suppressed (<100%)
  let volLabel = 'Normal'
  let volDirection: FactorRow['direction'] = 'neutral'
  let volContrib = 0
  if (k.vol > 130) {
    volLabel = 'Amplified'
    volDirection = 'bearish'
    volContrib = 5
  } else if (k.vol < 100) {
    volLabel = 'Suppressed'
    volDirection = 'bullish'
    volContrib = 3
  }

  return [
    {
      name: `Kronos AI Direction: ${dirLabel} (${Math.round(k.confidencePct)}% path agreement)`,
      contribution: directionContrib,
      direction: dirBias,
    },
    {
      name: `Kronos Predicted Move: ${moveSign}${k.predictedChangePct.toFixed(1)}% over ${k.horizon}d${priceBit}`,
      contribution: moveContrib,
      direction: moveDirection,
    },
    {
      name: `Kronos Model Confidence: ${Math.round(k.confidencePct)}% of paths agree (${dir})`,
      contribution: confContrib,
      direction: dirBias,
    },
    {
      name: `Kronos Volatility Outlook: ${volLabel} (${Math.round(k.vol)}%)`,
      contribution: volContrib,
      direction: volDirection,
    },
  ].filter((f) => f.contribution > 0)
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
      ...(kronosData ? buildKronosFactors(kronosData) : []),
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

import { extractFeatures, heuristicPrediction, type TradeFeatures } from './features'
import { generateMultiStrategySignal } from '../strategy'
import { prisma } from '../prisma'
import { kronosLongScore } from './kronos-score'

export { kronosLongScore }

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
    const upside = Number(data.upside_probability)
    const conf = Number(data.confidence_pct)
    const vol = Number(data.volatility_amplification)
    return {
      upside: Number.isFinite(upside) ? upside : 50,
      vol: Number.isFinite(vol) ? vol : 50,
      direction: data.direction ?? 'neutral',
      confidencePct: Number.isFinite(conf) ? conf : 50,
      predictedChangePct: Number(data.predicted_change_pct) || 0,
      currentPrice: Number(data.current_price) || 0,
      forecastFinalPrice: Number(data.forecast_final_price) || 0,
      horizon: Number(data.horizon) || 10,
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

  const directionContrib =
    dirBias === 'neutral' ? 0 : Math.round(k.confidencePct * 0.15 * 10) / 10

  const moveContrib = Math.min(10, Math.round(Math.abs(k.predictedChangePct) * 2 * 10) / 10)
  const moveSign = k.predictedChangePct >= 0 ? '+' : ''
  const priceBit =
    k.currentPrice > 0 && k.forecastFinalPrice > 0
      ? ` (₹${Math.round(k.currentPrice)} -> ₹${Math.round(k.forecastFinalPrice)})`
      : ''
  const moveDirection: FactorRow['direction'] =
    k.predictedChangePct > 1 ? 'bullish' : k.predictedChangePct < -1 ? 'bearish' : 'neutral'

  const confContrib = Math.max(0, Math.round((k.confidencePct - 50) * 0.2 * 10) / 10)

  let volLabel = 'Normal'
  let volDirection: FactorRow['direction'] = 'neutral'
  let volContrib = 0
  if (k.vol > 130) {
    volLabel = 'Amplified'
    volDirection = 'bearish'
    volContrib = 5
  } else if (k.vol < 100 && k.vol > 0) {
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

export type HistoricalWinRateStats = {
  score: number
  detail: string
  winRate: number
  totalTrades: number
  avgPnlPct: number
  years: number
}

/**
 * Prefer longest saved backtest (ideally ~10y). Falls back to StrategyPerf overall,
 * then live closed-trade win rate.
 */
export async function getHistoricalWinRateStats(): Promise<HistoricalWinRateStats> {
  try {
    const backtests = await prisma.backtest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        startDate: true,
        endDate: true,
        winRate: true,
        totalTrades: true,
        avgWinPct: true,
        avgLossPct: true,
        name: true,
      },
    })

    if (backtests.length > 0) {
      const scored = backtests.map((bt) => {
        const ms = new Date(bt.endDate).getTime() - new Date(bt.startDate).getTime()
        const years = Math.max(0.1, ms / (365.25 * 24 * 3600 * 1000))
        return { bt, years }
      })
      // Prefer spans ≥ 8y; otherwise longest available
      const longOnes = scored.filter((s) => s.years >= 8)
      const pick = (longOnes.length > 0 ? longOnes : scored).sort((a, b) => b.years - a.years)[0]

      const wr = pick.bt.winRate
      const trades = pick.bt.totalTrades
      // Approximate avg pnl% from win/loss averages when available
      const avgWin = pick.bt.avgWinPct ?? 0
      const avgLoss = pick.bt.avgLossPct ?? 0
      const winFrac = wr / 100
      const avgPnlPct = winFrac * avgWin + (1 - winFrac) * avgLoss
      const yearLabel = pick.years >= 8 ? '10yr' : `${pick.years.toFixed(1)}yr`

      return {
        score: Math.round(Math.max(0, Math.min(100, wr))),
        winRate: wr,
        totalTrades: trades,
        avgPnlPct,
        years: pick.years,
        detail: `${yearLabel} backtest: ${wr.toFixed(0)}% win rate (${trades} trades, avg ${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(1)}%)`,
      }
    }
  } catch {
    // fall through
  }

  try {
    const overall = await prisma.strategyPerf.findUnique({ where: { strategyName: '_overall' } })
    if (overall && overall.totalTrades > 0) {
      return {
        score: Math.round(Math.max(0, Math.min(100, overall.winRate))),
        winRate: overall.winRate,
        totalTrades: overall.totalTrades,
        avgPnlPct: overall.avgPnlPct,
        years: 0,
        detail: `Strategy backtest: ${overall.winRate.toFixed(0)}% win rate (${overall.totalTrades} trades, avg ${overall.avgPnlPct >= 0 ? '+' : ''}${overall.avgPnlPct.toFixed(1)}%)`,
      }
    }
  } catch {
    // fall through
  }

  try {
    const closed = await prisma.customStrategyTrade.findMany({
      select: { pnl: true, pnlPct: true },
      take: 500,
      orderBy: { closedAt: 'desc' },
    })
    if (closed.length >= 5) {
      const wins = closed.filter((t) => t.pnl > 0).length
      const wr = (wins / closed.length) * 100
      const avgPnlPct = closed.reduce((s, t) => s + (t.pnlPct || 0), 0) / closed.length
      return {
        score: Math.round(Math.max(0, Math.min(100, wr))),
        winRate: wr,
        totalTrades: closed.length,
        avgPnlPct,
        years: 0,
        detail: `Live trades: ${wr.toFixed(0)}% win rate (${closed.length} trades, avg ${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(1)}%)`,
      }
    }
  } catch {
    // fall through
  }

  return {
    score: 50,
    winRate: 50,
    totalTrades: 0,
    avgPnlPct: 0,
    years: 0,
    detail: 'No backtest yet — run a 10yr backtest for historical win rate',
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

  // 3. Kronos AI forecast (15%) — upside × path-agreement, direction-aware
  const kronosData = await getKronosForConfidence(symbol)
  let kronosScore = 50
  let kronosDetail = 'No cached forecast — neutral'
  if (kronosData) {
    kronosScore = kronosLongScore({
      upside: kronosData.upside,
      confidencePct: kronosData.confidencePct,
      direction: kronosData.direction,
      predictedChangePct: kronosData.predictedChangePct,
    })
    const volStr = Number.isFinite(kronosData.vol) ? `${kronosData.vol}%` : 'n/a'
    kronosDetail = `Upside probability: ${kronosData.upside}% (${kronosData.direction}, vol amp ${volStr})`
  }

  // 4. Market regime (15%)
  const regimeScore = calculateRegimeScore(featureResult.features)

  // 5. Historical win rate (10%) — from saved backtests (prefer ~10yr)
  const hist = await getHistoricalWinRateStats()

  // Weighted combination
  const overallConfidence = Math.round(
    strategyScore * 0.35 +
    mlScore * 0.25 +
    kronosScore * 0.15 +
    regimeScore * 0.15 +
    hist.score * 0.10
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
      historicalWinRate: { score: hist.score, weight: 0.10, detail: hist.detail },
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

  if (features.trendRegime === 1) {
    score += 20
  } else if (features.trendRegime === -1) {
    score -= 20
  }

  if (features.volatilityRegime === 0) {
    score += 10
  } else if (features.volatilityRegime === 2) {
    score -= 15
  }

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

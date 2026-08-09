/**
 * Long-side suitability score from Kronos Monte Carlo metrics (0–100).
 *
 * Uses upside_probability (paths ending above spot) blended with path-agreement
 * confidence_pct, oriented for BUY decisions:
 *   - bullish + high agreement → high score
 *   - bearish + high agreement → low score
 *   - neutral → near upside alone
 */
export function kronosLongScore(opts: {
  upside: number
  confidencePct: number
  direction: string
  predictedChangePct?: number
}): number {
  const upside = Math.max(0, Math.min(100, opts.upside))
  const conf = Math.max(0, Math.min(100, opts.confidencePct || 50))
  const dir = (opts.direction || 'neutral').toLowerCase()

  let score: number
  if (dir === 'bullish') {
    score = upside * 0.55 + conf * 0.45
  } else if (dir === 'bearish') {
    score = upside * 0.55 + (100 - conf) * 0.45
  } else {
    score = upside * 0.7 + 50 * 0.3
  }

  const move = opts.predictedChangePct ?? 0
  score += Math.max(-5, Math.min(5, move))

  return Math.round(Math.max(0, Math.min(100, score)))
}

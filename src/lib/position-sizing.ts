/**
 * Position sizing — confidence scales dollar amount continuously.
 * No per-trade ₹ cap and no fixed minimum score to enter.
 *
 *   conf 0   → ~0.5% of equity (tiny probe)
 *   conf 50  → ~8%
 *   conf 100 → ~35% of equity (still limited by investable cash)
 */
export function allocationPctFromConfidence(confidence: number): number {
  const c = Math.max(0, Math.min(100, confidence))
  // Continuous: 0.5% at score 0 → 35% at score 100
  return 0.005 + (c / 100) * 0.345
}

/** @deprecated Kept for API compat — no hard ₹ cap; sizing uses investable cash only. */
export const MAX_ALLOCATION_PER_TRADE = Number.POSITIVE_INFINITY

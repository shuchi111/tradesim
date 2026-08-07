import { prisma } from '@/lib/prisma'

/** Minimum closed trades before we trust the cached WR for AI Score. */
export const HIST_WR_MIN_TRADES = 20

/** Neutral score when no cache / too few trades. */
export const HIST_WR_NEUTRAL = 50

export type HistWinRateResult = {
  score: number
  detail: string
  source: 'backtest' | 'neutral'
}

/**
 * Load cached per-symbol historical win rate (from long-horizon single-symbol backtests).
 * Falls back to neutral 50 when missing or under-sampled — never remaps strategy confidence.
 */
export async function getHistoricalWinRateForConfidence(
  symbol: string
): Promise<HistWinRateResult> {
  try {
    const row = await prisma.symbolBacktestPerf.findUnique({
      where: { symbol },
    })

    if (!row) {
      return {
        score: HIST_WR_NEUTRAL,
        detail: 'No backtest WR cache — neutral',
        source: 'neutral',
      }
    }

    if (row.totalTrades < HIST_WR_MIN_TRADES) {
      return {
        score: HIST_WR_NEUTRAL,
        detail: `Backtest WR under-sampled (${row.totalTrades} trades, need ${HIST_WR_MIN_TRADES}) — neutral`,
        source: 'neutral',
      }
    }

    const yearsLabel =
      row.years >= 9.5 ? '10y' : `${row.years.toFixed(0)}y`
    const score = Math.max(0, Math.min(100, Math.round(row.winRate)))

    return {
      score,
      detail: `Backtest WR: ${score}% (${row.totalTrades} trades, ${yearsLabel})`,
      source: 'backtest',
    }
  } catch {
    return {
      score: HIST_WR_NEUTRAL,
      detail: 'WR cache unavailable — neutral',
      source: 'neutral',
    }
  }
}

export type SymbolBacktestPerfInput = {
  symbol: string
  winRate: number
  totalTrades: number
  wins: number
  losses: number
  avgPnlPct: number
  rangeStart: Date
  rangeEnd: Date
  years: number
  backtestId?: number | null
}

export async function upsertSymbolBacktestPerf(input: SymbolBacktestPerfInput) {
  return prisma.symbolBacktestPerf.upsert({
    where: { symbol: input.symbol },
    create: {
      symbol: input.symbol,
      winRate: input.winRate,
      totalTrades: input.totalTrades,
      wins: input.wins,
      losses: input.losses,
      avgPnlPct: input.avgPnlPct,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      years: input.years,
      backtestId: input.backtestId ?? null,
      updatedAt: new Date(),
    },
    update: {
      winRate: input.winRate,
      totalTrades: input.totalTrades,
      wins: input.wins,
      losses: input.losses,
      avgPnlPct: input.avgPnlPct,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      years: input.years,
      backtestId: input.backtestId ?? null,
      updatedAt: new Date(),
    },
  })
}

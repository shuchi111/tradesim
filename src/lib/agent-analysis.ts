import type { AgentAnalysis, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const SCANNER_URL = process.env.SCANNER_INTERNAL_URL || 'http://localhost:8000'

export interface AgentAnalysisResult {
  ticker: string
  trade_date: string
  timestamp: string
  agent_reports: Record<string, string | undefined>
  final_trade_decision: string
  recommendation: Record<string, unknown>
}

export function todayTradeDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function toAnalysisResult(row: AgentAnalysis): AgentAnalysisResult {
  return {
    ticker: row.ticker,
    trade_date: row.tradeDate,
    timestamp: (row.completedAt ?? row.createdAt).toISOString(),
    agent_reports: (row.agentReports as Record<string, string | undefined>) ?? {},
    final_trade_decision: row.finalTradeDecision ?? '',
    recommendation: (row.recommendation as Record<string, unknown>) ?? {},
  }
}

export function toHistoryItem(row: AgentAnalysis) {
  return {
    id: row.id,
    ticker: row.ticker,
    trade_date: row.tradeDate,
    signal: row.signal ?? 'UNKNOWN',
    confidence: row.confidence ?? 0,
    size_fraction: row.sizeFraction ?? 0,
    target_price: row.targetPrice,
    stop_loss: row.stopLoss,
    task_id: row.taskId ?? undefined,
    status: row.status,
    cached: row.status === 'completed',
  }
}

export async function persistCompletedAnalysis(
  taskId: string,
  scannerResult: AgentAnalysisResult
) {
  const rec = scannerResult.recommendation as {
    signal?: string
    confidence?: number
    size_fraction?: number
    target_price?: number | null
    stop_loss?: number | null
  }

  return prisma.agentAnalysis.upsert({
    where: {
      ticker_tradeDate: {
        ticker: scannerResult.ticker,
        tradeDate: scannerResult.trade_date,
      },
    },
    create: {
      taskId,
      ticker: scannerResult.ticker,
      tradeDate: scannerResult.trade_date,
      status: 'completed',
      signal: rec.signal ?? 'UNKNOWN',
      confidence: rec.confidence ?? 0,
      sizeFraction: rec.size_fraction ?? 0,
      targetPrice: rec.target_price ?? null,
      stopLoss: rec.stop_loss ?? null,
      finalTradeDecision: scannerResult.final_trade_decision,
      agentReports: scannerResult.agent_reports as Prisma.InputJsonValue,
      recommendation: scannerResult.recommendation as Prisma.InputJsonValue,
      completedAt: new Date(),
      progress: `Done: ${rec.signal ?? 'UNKNOWN'}`,
    },
    update: {
      taskId,
      status: 'completed',
      signal: rec.signal ?? 'UNKNOWN',
      confidence: rec.confidence ?? 0,
      sizeFraction: rec.size_fraction ?? 0,
      targetPrice: rec.target_price ?? null,
      stopLoss: rec.stop_loss ?? null,
      finalTradeDecision: scannerResult.final_trade_decision,
      agentReports: scannerResult.agent_reports as Prisma.InputJsonValue,
      recommendation: scannerResult.recommendation as Prisma.InputJsonValue,
      error: null,
      completedAt: new Date(),
      progress: `Done: ${rec.signal ?? 'UNKNOWN'}`,
    },
  })
}

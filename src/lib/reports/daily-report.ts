import { prisma } from '../prisma'
import { getRiskStatus, ensureAccount } from '../trading'
import { getMarketPrice } from '../trading'
import { calculateMetrics } from '../metrics'
import { reportDateFromKey, toReportDateKey } from '../report-date-utils'

export interface DailyReportData {
  reportDate: Date
  startingEquity: number
  endingEquity: number
  dailyPnl: number
  dailyPnlPct: number
  tradesCount: number
  winRate: number
  metrics: Record<string, number>
  tradesData: Record<string, unknown>[]
  riskEvents: Record<string, unknown>[]
  summary: string
  topWinners: Record<string, unknown>[]
  topLosers: Record<string, unknown>[]
  openPositions: Record<string, unknown>[]
  agentAnalyses: Record<string, unknown>[]
  scannerPicks: Record<string, unknown>[]
}

/**
 * Generate a comprehensive daily report.
 */
export async function generateDailyReport(targetDate?: Date): Promise<DailyReportData> {
  const reportDate = targetDate ?? new Date()
  const dateKey = toReportDateKey(reportDate)

  // IST calendar-day boundaries
  const dayStart = reportDateFromKey(dateKey)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1)

  // Get all closed trades for the day
  const closedTrades = await prisma.customStrategyTrade.findMany({
    where: {
      closedAt: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { closedAt: 'asc' },
  })

  // Get risk events for the day
  const riskEvents = await prisma.trailingStopEvent.findMany({
    where: {
      timestamp: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { timestamp: 'asc' },
  })

  // Current account and risk status
  const account = await ensureAccount()
  const risk = await getRiskStatus()

  // Calculate daily P&L
  const dailyPnl = closedTrades.reduce((s, t) => s + t.pnl, 0)
  const wins = closedTrades.filter(t => t.pnl > 0)
  const losses = closedTrades.filter(t => t.pnl < 0)
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0

  // Get starting equity: either last report's ending, or the account starting equity
  const yesterdayReport = await prisma.dailyReport.findFirst({
    where: { reportDate: { lt: dayStart } },
    orderBy: { reportDate: 'desc' },
  })
  const startingEquity = yesterdayReport?.endingEquity ?? account.startingEquity
  const endingEquity = risk.totalEquity
  const dailyPnlPct = startingEquity > 0 ? (dailyPnl / startingEquity) * 100 : 0

  // Full metrics calculation using all closed trades
  const allTrades = await prisma.customStrategyTrade.findMany({
    orderBy: { closedAt: 'asc' },
  })
  const metricsResult = calculateMetrics(
    allTrades.map(t => ({
      pnl: t.pnl,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
    })),
    account.startingEquity,
    endingEquity,
    {
      startDate: account.createdAt,
      totalDeposited: account.totalDeposited,
      deposits: account.lastSipDate
        ? [{ date: account.lastSipDate, amount: account.sipAmountInr }]
        : [],
    }
  )

  // Top winners and losers
  const sortedTrades = [...closedTrades].sort((a, b) => b.pnl - a.pnl)
  const topWinners = sortedTrades.filter(t => t.pnl > 0).slice(0, 3).map(t => ({
    symbol: t.symbol,
    pnl: t.pnl,
    pnlPct: ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100,
    exitReason: t.exitReason,
    holdDuration: t.holdDuration,
  }))
  const topLosers = sortedTrades.filter(t => t.pnl < 0).reverse().slice(0, 3).map(t => ({
    symbol: t.symbol,
    pnl: t.pnl,
    pnlPct: ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100,
    exitReason: t.exitReason,
    holdDuration: t.holdDuration,
  }))

  // Open positions snapshot
  const positions = await prisma.position.findMany()
  const openPositions = []
  for (const pos of positions) {
    try {
      const price = await getMarketPrice(pos.symbol)
      openPositions.push({
        symbol: pos.symbol,
        entryPrice: pos.entryPrice,
        currentPrice: price,
        pnlPct: ((price - pos.entryPrice) / pos.entryPrice) * 100,
        pnl: (price - pos.entryPrice) * pos.quantity,
        peakPrice: pos.peakPrice,
        peakGainPct: ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100,
        quantity: pos.quantity,
      })
    } catch {
      // skip
    }
  }

  // Risk event summary
  const riskEventSummary = riskEvents.map(e => ({
    timestamp: e.timestamp,
    symbol: e.symbol,
    eventType: e.eventType,
    triggerReason: e.triggerReason,
    pnlPct: e.pnlPct,
    peakGainPct: e.peakGainPct,
  }))

  // Trade-level data for CSV export
  const tradesData = closedTrades.map(t => ({
    symbol: t.symbol,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    pnl: t.pnl,
    pnlPct: ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100,
    exitReason: t.exitReason,
    entryReason: t.entryReason,
    maxFavorable: t.maxFavorable,
    maxAdverse: t.maxAdverse,
    holdDuration: t.holdDuration,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
  }))

  // Executive summary
  const summary = generateExecutiveSummary({
    dailyPnl,
    dailyPnlPct,
    endingEquity,
    winRate,
    tradesCount: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    drawdownPct: risk.drawdownPct,
    positionsCount: risk.positionsCount,
    riskEventsCount: riskEvents.length,
  })

  // Fetch TradingAgents analyses and scanner picks for the report
  let agentAnalyses: Record<string, unknown>[] = []
  let scannerPicks: Record<string, unknown>[] = []
  try {
    const dateStr = dateKey
    const [agentHistResp, scanResp] = await Promise.all([
      fetch(`http://localhost:8000/api/agents/history?limit=10`),
      fetch(`http://localhost:8000/api/scan/latest`),
    ])
    if (agentHistResp.ok) {
      const agentData = await agentHistResp.json()
      agentAnalyses = (agentData.history || []).filter((h: Record<string, unknown>) =>
        h.trade_date === dateStr || h.trade_date === dateStr.slice(0, 10)
      )
    }
    if (scanResp.ok) {
      const scanData = await scanResp.json()
      scannerPicks = (scanData.picks || []).map((p: Record<string, unknown>) => ({
        symbol: p.symbol,
        score: p.score,
        confidence: p.confidence,
        entry_low: p.entry_low,
        entry_high: p.entry_high,
        stop_loss: p.stop_loss,
        target_1: p.target_1,
        target_2: p.target_2,
        methods_triggered: p.methods_triggered,
        risk_tag: p.risk_tag,
      }))
    }
  } catch {
    // Scanner API may not be running — skip gracefully
  }

  const reportData: DailyReportData = {
    reportDate: dayStart,
    startingEquity,
    endingEquity,
    dailyPnl,
    dailyPnlPct,
    tradesCount: closedTrades.length,
    winRate,
    metrics: {
      sharpe: metricsResult.sharpe,
      maxDrawdown: metricsResult.maxDrawdown,
      profitFactor: metricsResult.profitFactor,
      expectancy: metricsResult.expectancy,
      cagr: metricsResult.cagr,
      xirr: metricsResult.xirr,
      totalReturn: metricsResult.totalReturn,
      avgWin: metricsResult.avgWin,
      avgLoss: metricsResult.avgLoss,
    },
    tradesData,
    riskEvents: riskEventSummary,
    summary,
    topWinners,
    topLosers,
    openPositions,
    agentAnalyses,
    scannerPicks,
  }

  // Save to database
  await prisma.dailyReport.upsert({
    where: { reportDate: dayStart },
    create: {
      reportDate: dayStart,
      startingEquity,
      endingEquity,
      dailyPnl,
      dailyPnlPct,
      tradesCount: closedTrades.length,
      winRate,
      metrics: reportData.metrics as any,
      tradesData: tradesData as any,
      riskEvents: riskEventSummary as any,
      summary,
      topWinners: topWinners as any,
      topLosers: topLosers as any,
      openPositions: openPositions as any,
    },
    update: {
      startingEquity,
      endingEquity,
      dailyPnl,
      dailyPnlPct,
      tradesCount: closedTrades.length,
      winRate,
      metrics: reportData.metrics as any,
      tradesData: tradesData as any,
      riskEvents: riskEventSummary as any,
      summary,
      topWinners: topWinners as any,
      topLosers: topLosers as any,
      openPositions: openPositions as any,
    },
  })

  return reportData
}

function generateExecutiveSummary(data: {
  dailyPnl: number
  dailyPnlPct: number
  endingEquity: number
  winRate: number
  tradesCount: number
  wins: number
  losses: number
  drawdownPct: number
  positionsCount: number
  riskEventsCount: number
}): string {
  const pnlStr = data.dailyPnl >= 0 ? `+₹${data.dailyPnl.toFixed(2)}` : `-₹${Math.abs(data.dailyPnl).toFixed(2)}`
  const direction = data.dailyPnl >= 0 ? 'profitable' : 'in the red'

  return `Today was ${direction} with ${pnlStr} (${data.dailyPnlPct >= 0 ? '+' : ''}${data.dailyPnlPct.toFixed(2)}%) P&L. ` +
    `Closed ${data.tradesCount} trades (${data.wins}W / ${data.losses}L, ${data.winRate.toFixed(0)}% win rate). ` +
    `Portfolio equity stands at ₹${data.endingEquity.toFixed(0)} with ${data.positionsCount} open positions. ` +
    `Drawdown: ${data.drawdownPct.toFixed(1)}%. ${data.riskEventsCount} risk events triggered.`
}

/**
 * Convert report data to CSV format for download.
 */
export function reportToCsv(report: DailyReportData): string {
  const headers = [
    'Symbol', 'Entry Price', 'Exit Price', 'P&L', 'P&L (%)',
    'Exit Reason', 'Entry Reason', 'MFE (%)', 'MAE (%)',
    'Hold Duration (min)', 'Opened At', 'Closed At',
  ]

  const rows = report.tradesData.map((t: any) => [
    t.symbol,
    t.entryPrice.toFixed(2),
    t.exitPrice.toFixed(2),
    t.pnl.toFixed(2),
    t.pnlPct.toFixed(2),
    t.exitReason || 'manual',
    t.entryReason || 'manual',
    (t.maxFavorable ?? 0).toFixed(2),
    (t.maxAdverse ?? 0).toFixed(2),
    t.holdDuration ?? 0,
    new Date(t.openedAt).toISOString(),
    new Date(t.closedAt).toISOString(),
  ])

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  return csv
}

/**
 * Convert report data to a print-ready HTML format for PDF generation.
 */
export function reportToHtml(report: DailyReportData): string {
  const m = report.metrics
  const dateStr = report.reportDate.toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const tradeRows = (report.tradesData as any[]).map((t: any) => `
    <tr>
      <td>${t.symbol}</td>
      <td>₹${t.entryPrice.toFixed(2)}</td>
      <td>₹${t.exitPrice.toFixed(2)}</td>
      <td class="${t.pnl >= 0 ? 'pos' : 'neg'}">₹${t.pnl.toFixed(2)}</td>
      <td class="${t.pnlPct >= 0 ? 'pos' : 'neg'}">${t.pnlPct.toFixed(2)}%</td>
      <td>${t.exitReason || 'manual'}</td>
      <td>${t.holdDuration ?? 0} min</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>TradeSim Daily Report — ${dateStr}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #1a1a1a; }
  h1 { color: #0e0f14; border-bottom: 3px solid #2962ff; padding-bottom: 10px; }
  h2 { color: #333; margin-top: 30px; }
  .summary { background: #f5f5f5; padding: 15px; border-radius: 8px; font-size: 14px; line-height: 1.6; }
  .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
  .metric-card { background: #f9f9f9; border: 1px solid #ddd; padding: 12px; border-radius: 6px; text-align: center; }
  .metric-value { font-size: 22px; font-weight: bold; color: #0e0f14; }
  .metric-label { font-size: 11px; color: #666; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #0e0f14; color: #fff; padding: 8px; text-align: left; font-size: 12px; }
  td { padding: 8px; border-bottom: 1px solid #eee; font-size: 13px; }
  .pos { color: #00c853; font-weight: bold; }
  .neg { color: #ff1744; font-weight: bold; }
  .header-info { display: flex; justify-content: space-between; align-items: center; }
  .pnl-big { font-size: 36px; font-weight: bold; }
</style>
</head>
<body>
  <div class="header-info">
    <h1>TradeSim Daily Report</h1>
    <div style="text-align: right;">
      <div style="font-size: 14px; color: #666;">${dateStr}</div>
    </div>
  </div>

  <div class="summary">${report.summary}</div>

  <div style="margin: 20px 0;">
    <div class="pnl-big ${report.dailyPnl >= 0 ? 'pos' : 'neg'}">
      ${report.dailyPnl >= 0 ? '+' : ''}₹${report.dailyPnl.toFixed(2)}
      <span style="font-size: 16px;">(${report.dailyPnlPct >= 0 ? '+' : ''}${report.dailyPnlPct.toFixed(2)}%)</span>
    </div>
    <div style="color: #666; font-size: 14px; margin-top: 5px;">Portfolio Equity: ₹${report.endingEquity.toFixed(0)}</div>
  </div>

  <h2>Performance Metrics</h2>
  <div class="metrics-grid">
    <div class="metric-card"><div class="metric-value">${report.winRate.toFixed(0)}%</div><div class="metric-label">Win Rate</div></div>
    <div class="metric-card"><div class="metric-value">${m.sharpe?.toFixed(2) ?? '0.00'}</div><div class="metric-label">Sharpe</div></div>
    <div class="metric-card"><div class="metric-value">${m.maxDrawdown?.toFixed(1) ?? '0.0'}%</div><div class="metric-label">Max DD</div></div>
    <div class="metric-card"><div class="metric-value">${m.profitFactor?.toFixed(2) ?? '0.00'}</div><div class="metric-label">Profit Factor</div></div>
    <div class="metric-card"><div class="metric-value">${m.expectancy?.toFixed(2) ?? '0.00'}</div><div class="metric-label">Expectancy</div></div>
    <div class="metric-card"><div class="metric-value">${m.cagr?.toFixed(1) ?? '0.0'}%</div><div class="metric-label">CAGR</div></div>
    <div class="metric-card"><div class="metric-label">XIRR</div><div class="metric-value">${m.xirr?.toFixed(1) ?? '0.0'}%</div></div>
    <div class="metric-card"><div class="metric-value">${report.tradesCount}</div><div class="metric-label">Trades</div></div>
  </div>

  <h2>Trade Log (${report.tradesCount} trades)</h2>
  <table>
    <thead><tr><th>Symbol</th><th>Entry</th><th>Exit</th><th>P&L</th><th>P&L %</th><th>Exit Reason</th><th>Hold</th></tr></thead>
    <tbody>${tradeRows}</tbody>
  </table>

  ${(report.riskEvents as any[]).length > 0 ? `
  <h2>Risk Events (${(report.riskEvents as any[]).length})</h2>
  <table>
    <thead><tr><th>Time</th><th>Symbol</th><th>Event</th><th>Reason</th><th>P&L %</th></tr></thead>
    <tbody>
      ${(report.riskEvents as any[]).map((e: any) => `
        <tr>
          <td>${new Date(e.timestamp).toLocaleTimeString('en-IN')}</td>
          <td>${e.symbol}</td>
          <td>${e.eventType.replace(/_/g, ' ')}</td>
          <td>${e.triggerReason}</td>
          <td class="${e.pnlPct >= 0 ? 'pos' : 'neg'}">${e.pnlPct.toFixed(2)}%</td>
        </tr>`).join('')}
    </tbody>
  </table>` : ''}

  ${(report.openPositions as any[]).length > 0 ? `
  <h2>Open Positions (${(report.openPositions as any[]).length})</h2>
  <table>
    <thead><tr><th>Symbol</th><th>Entry</th><th>Current</th><th>P&L %</th><th>Peak Gain</th></tr></thead>
    <tbody>
      ${(report.openPositions as any[]).map((p: any) => `
        <tr>
          <td>${p.symbol}</td>
          <td>₹${p.entryPrice.toFixed(2)}</td>
          <td>₹${p.currentPrice.toFixed(2)}</td>
          <td class="${p.pnlPct >= 0 ? 'pos' : 'neg'}">${p.pnlPct.toFixed(2)}%</td>
          <td class="pos">+${p.peakGainPct.toFixed(2)}%</td>
        </tr>`).join('')}
    </tbody>
  </table>` : ''}

  ${(report.agentAnalyses as any[]).length > 0 ? `
  <h2>🏛️ Tauric Research TradingAgents — AI Analysis (${(report.agentAnalyses as any[]).length})</h2>
  <p style="font-size: 12px; color: #666; margin-bottom: 10px;">10-agent LLM trading firm: 4 analysts → bull/bear debate → trader → risk management debate → final decision</p>
  <table>
    <thead><tr><th>Ticker</th><th>Signal</th><th>Confidence</th><th>Size</th><th>Target</th><th>Stop Loss</th></tr></thead>
    <tbody>
      ${(report.agentAnalyses as any[]).map((a: any) => `
        <tr>
          <td><strong>${a.ticker}</strong></td>
          <td><span class="${a.signal === 'BUY' ? 'pos' : a.signal === 'SELL' ? 'neg' : ''}" style="font-weight:bold;">${a.signal}</span></td>
          <td>${(a.confidence * 100).toFixed(0)}%</td>
          <td>${(a.size_fraction * 100).toFixed(0)}%</td>
          <td>${a.target_price ? '₹' + a.target_price.toFixed(2) : '-'}</td>
          <td>${a.stop_loss ? '₹' + a.stop_loss.toFixed(2) : '-'}</td>
        </tr>`).join('')}
    </tbody>
  </table>` : ''}

  ${(report.scannerPicks as any[]).length > 0 ? `
  <h2>🔬 Swing Trade Scanner — Top Picks (${(report.scannerPicks as any[]).length})</h2>
  <p style="font-size: 12px; color: #666; margin-bottom: 10px;">7-method scanner: breakout+volume, supertrend+MACD, RSI reversal, EMA crossover, sector momentum, bullish engulfing, AI composite</p>
  <table>
    <thead><tr><th>Symbol</th><th>Score</th><th>Entry Zone</th><th>Stop Loss</th><th>Target 1</th><th>Target 2</th><th>Risk</th></tr></thead>
    <tbody>
      ${(report.scannerPicks as any[]).map((p: any) => `
        <tr>
          <td><strong>${p.symbol}</strong></td>
          <td>${p.score}/10</td>
          <td>₹${p.entry_low}–${p.entry_high}</td>
          <td class="neg">₹${p.stop_loss}</td>
          <td class="pos">₹${p.target_1}</td>
          <td class="pos">₹${p.target_2}</td>
          <td>${p.risk_tag}</td>
        </tr>`).join('')}
    </tbody>
  </table>` : ''}

  <p style="margin-top: 30px; color: #999; font-size: 11px;">Generated by TradeSim AI Trading Intelligence Platform — Tauric Research TradingAgents Integration</p>
</body>
</html>`
}

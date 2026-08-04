/**
 * Financial metrics for trading performance analysis.
 */

export interface TradeRecord {
  pnl: number
  openedAt: string | Date
  closedAt: string | Date
}

/**
 * Expectancy = (Win Rate * Average Win) - (Loss Rate * Average Loss)
 * Positive expectancy = profitable system over time.
 */
export function expectancy(trades: TradeRecord[]): number {
  if (trades.length === 0) return 0
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const winRate = wins.length / trades.length
  const lossRate = 1 - winRate
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0
  return winRate * avgWin - lossRate * avgLoss
}

/**
 * XIRR (Extended Internal Rate of Return) using Newton-Raphson.
 * Takes cash flows: [{ date, amount }] where negative = investment, positive = return.
 */
export function xirr(
  cashFlows: Array<{ date: Date; amount: number }>,
  guess: number = 0.1
): number {
  if (cashFlows.length < 2) return 0

  const t0 = cashFlows[0].date.getTime()
  const years = (d: Date) => (d.getTime() - t0) / (365.25 * 24 * 60 * 60 * 1000)

  const xnpv = (rate: number): number => {
    return cashFlows.reduce((sum, cf) => {
      return sum + cf.amount / Math.pow(1 + rate, years(cf.date))
    }, 0)
  }

  const xnpvDeriv = (rate: number): number => {
    return cashFlows.reduce((sum, cf) => {
      const y = years(cf.date)
      return sum - (y * cf.amount) / Math.pow(1 + rate, y + 1)
    }, 0)
  }

  let rate = guess
  for (let i = 0; i < 100; i++) {
    const f = xnpv(rate)
    const df = xnpvDeriv(rate)
    if (Math.abs(df) < 1e-10) break
    const newRate = rate - f / df
    if (!isFinite(newRate)) return 0
    if (Math.abs(newRate - rate) < 1e-7) return newRate
    rate = newRate
  }
  return isFinite(rate) ? rate : 0
}

/**
 * CAGR (Compound Annual Growth Rate)
 * CAGR = (End Value / Start Value)^(1 / years) - 1
 */
export function cagr(
  startValue: number,
  endValue: number,
  startDate: Date,
  endDate: Date
): number {
  const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  if (years <= 0 || startValue <= 0) return 0
  return Math.pow(endValue / startValue, 1 / years) - 1
}

/**
 * Sharpe Ratio (annualized, assuming risk-free rate of 0 for simplicity)
 * Uses daily returns from equity curve.
 */
export function sharpeRatio(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0
  const returns: number[] = []
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i - 1] > 0) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1])
    }
  }
  if (returns.length === 0) return 0
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return 0
  // Annualize: daily * sqrt(252)
  return (meanReturn / stdDev) * Math.sqrt(252)
}

/**
 * Maximum Drawdown from an equity curve.
 * Max DD = max peak-to-trough decline as a percentage.
 */
export function maxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0
  let peak = equityCurve[0]
  let maxDd = 0
  for (const value of equityCurve) {
    if (value > peak) peak = value
    const dd = (peak - value) / peak
    if (dd > maxDd) maxDd = dd
  }
  return maxDd * 100
}

/**
 * Profit Factor = Gross Profit / Gross Loss
 * > 1 = profitable, > 1.5 = good, > 2 = excellent
 */
export function profitFactor(trades: TradeRecord[]): number {
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0
  return grossProfit / grossLoss
}

/**
 * Deposit record for SIP / capital injection tracking.
 */
export interface DepositRecord {
  date: Date
  amount: number
}

/**
 * Calculate all metrics from trade history.
 *
 * @param trades          Closed trade records
 * @param startingEquity  Initial capital (₹1,00,000)
 * @param currentEquity   Current portfolio value (balance + positions)
 * @param options         Optional: account creation date, deposits, total deposited
 */
export function calculateMetrics(
  trades: TradeRecord[],
  startingEquity: number,
  currentEquity: number,
  options?: {
    startDate?: Date        // account creation date — for CAGR period
    deposits?: DepositRecord[]  // SIP deposits: [{ date, amount }]
    totalDeposited?: number     // cumulative deposits (for invested capital)
  }
) {
  const accountStartDate = options?.startDate ?? new Date(trades[0]?.openedAt ?? Date.now())
  const deposits = options?.deposits ?? []
  const totalDeposited = options?.totalDeposited ?? 0

  // Sort trades chronologically
  const sortedTrades = [...trades].sort(
    (a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
  )

  const wins = sortedTrades.filter((t) => t.pnl > 0)
  const losses = sortedTrades.filter((t) => t.pnl < 0)
  const totalTrades = sortedTrades.length
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0
  // Realized P&L from closed trades only (SIP deposits are never P&L)
  const realizedPnl = sortedTrades.reduce((s, t) => s + t.pnl, 0)

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0

  // --- Equity curve (includes deposits so SIP doesn't look like P&L) ---
  // Merge trade closings and deposits into one chronological stream
  type Event = { date: Date; delta: number }
  const events: Event[] = sortedTrades.map((t) => ({
    date: new Date(t.closedAt),
    delta: t.pnl,
  }))
  for (const d of deposits) {
    events.push({ date: d.date, delta: d.amount })
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime())

  let runningEquity = startingEquity
  const equityCurve: number[] = [startingEquity]
  for (const evt of events) {
    runningEquity += evt.delta
    equityCurve.push(runningEquity)
  }

  // Invested capital = starting equity + SIP deposits (not profit)
  const investedCapital = startingEquity + totalDeposited
  // Total P&L = current equity minus all capital put in (excludes SIP from profit)
  const totalPnl = currentEquity - investedCapital
  const totalReturn = investedCapital > 0 ? (totalPnl / investedCapital) * 100 : 0

  // --- CAGR on invested capital → current equity (deposits are capital, not returns) ---
  const years =
    (Date.now() - accountStartDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  // Avoid absurd annualization on very short histories (< 30 days)
  const cagrValue =
    years >= 30 / 365.25 && investedCapital > 0
      ? cagr(investedCapital, currentEquity, accountStartDate, new Date()) * 100
      : 0

  // --- XIRR ---
  // Correct cash flow model:
  //   Day 0:  -startingEquity        (capital invested)
  //   Each SIP date: -depositAmount  (additional capital injected)
  //   Today:  +currentEquity          (full portfolio withdrawn hypothetically)
  const cashFlows: Array<{ date: Date; amount: number }> = []
  if (trades.length > 0 || totalDeposited > 0 || Math.abs(totalPnl) > 0.01) {
    cashFlows.push({ date: accountStartDate, amount: -startingEquity })
    for (const d of deposits) {
      cashFlows.push({ date: d.date, amount: -d.amount })
    }
    cashFlows.push({ date: new Date(), amount: currentEquity })
  }

  const xirrValue =
    cashFlows.length >= 2 ? xirr(cashFlows) * 100 : 0

  return {
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalPnl,
    realizedPnl,
    totalReturn,
    investedCapital,
    totalDeposited,
    expectancy: expectancy(sortedTrades),
    avgWin,
    avgLoss,
    profitFactor: profitFactor(sortedTrades),
    cagr: cagrValue,
    sharpe: sharpeRatio(equityCurve),
    maxDrawdown: maxDrawdown(equityCurve),
    xirr: xirrValue,
  }
}

import { prisma } from './prisma'
import { getPrice } from './market'
import { getInstrument, INSTRUMENTS } from '@/types'
import {
  allocationPctFromConfidence,
  MAX_ALLOCATION_PER_TRADE,
} from './position-sizing'

export { allocationPctFromConfidence, MAX_ALLOCATION_PER_TRADE } from './position-sizing'

// Starting balance is ₹1,00,000 INR (1 Lakh) — stored natively in INR.
export const STARTING_BALANCE = 100000
export const SIP_AMOUNT_INR = 20000
/** SIP deposits on this day of each month (IST), on or after this day once eligible. */
export const SIP_DAY_OF_MONTH = 7
/** Keep this fraction of starting equity as uninvestable cash reserve. */
export const CASH_RESERVE_PCT = 0.30
/** No hard position count — buy as many symbols as cash + confidence sizing allow. */
export const MAX_POSITIONS_ALLOWED = Number.POSITIVE_INFINITY
const MIN_INVESTABLE_CASH = 500
const MIN_TRADE_VALUE = 100
// Sell penalty: flat ₹150 INR per sell, permanently lost.
const SELL_PENALTY_FLAT = 150

/** Calendar parts in Asia/Kolkata (IST). */
export function getIstParts(date: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** First instant of the current IST calendar month. */
export function firstOfCurrentIstMonth(from: Date = new Date()): Date {
  const { year, month } = getIstParts(from)
  return new Date(Date.UTC(year, month - 1, 1, 6, 30, 0))
}

/** First instant of the next IST calendar month (approx. via UTC noon on day 1). */
export function firstOfNextIstMonth(from: Date = new Date()): Date {
  const { year, month } = getIstParts(from)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  // Noon UTC on the 1st avoids DST edge cases; IST is fixed UTC+5:30
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1, 6, 30, 0))
}

/** Whole-share quantity helper — rejects fractions. */
export function requireWholeShares(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive whole number')
  }
  if (!Number.isInteger(quantity)) {
    throw new Error('Fractional quantities are not allowed — use whole shares only')
  }
  return quantity
}

/**
 * Confidence-scaled size — no ₹ cap, no min score gate.
 * Lower score → smaller amount; higher score → larger amount.
 * Limited only by investable cash (and optional finite maxAllocation).
 */
export function sizePosition(opts: {
  totalEquity: number
  confidence: number
  investableCash: number
  price: number
  maxAllocation?: number
}): { qty: number; allocation: number; allocationPct: number } {
  const allocationPct = allocationPctFromConfidence(opts.confidence)
  const targetAllocation = opts.totalEquity * allocationPct
  const withOptionalCap =
    opts.maxAllocation != null && Number.isFinite(opts.maxAllocation)
      ? Math.min(targetAllocation, opts.maxAllocation)
      : targetAllocation
  const capped = Math.min(withOptionalCap, opts.investableCash)
  if (capped < MIN_TRADE_VALUE || opts.price <= 0) {
    return { qty: 0, allocation: 0, allocationPct }
  }
  const qty = Math.floor(capped / opts.price)
  if (qty < 1) return { qty: 0, allocation: 0, allocationPct }
  return { qty, allocation: qty * opts.price, allocationPct }
}

/**
 * Instruments available for auto-trading.
 * Expanded from a small whitelist to ALL NIFTY 50 stocks now that
 * the multi-strategy consensus engine provides stronger signal quality.
 * Multi-strategy agreement (2+ strategies voting together) replaces the
 * need for a pre-filtered backtested whitelist.
 *
 * US stocks (AAPL, NVDA, TSLA) and NIFTY50 index are excluded from
 * auto-trading to keep focus on Indian equities.
 */
const TRADABLE_STOCKS = new Set(
  INSTRUMENTS
    .filter((i) => i.currency === 'INR' && i.symbol !== 'NIFTY50')
    .map((i) => i.symbol)
)

/* ============================================================
 * TRADE EVENT LOGGING
 * ============================================================ */

export interface RiskEventMetadata {
  symbol: string
  eventType: string
  entryPrice: number
  currentPrice: number
  peakPrice: number
  pnlPct: number
  peakGainPct: number
  triggerReason: string
  tradeId?: number
  metadata?: Record<string, unknown>
}

/**
 * Log a trailing stop / risk event to the database.
 */
export async function logRiskEvent(event: RiskEventMetadata): Promise<void> {
  try {
    await prisma.trailingStopEvent.create({
      data: {
        tradeId: event.tradeId ?? null,
        symbol: event.symbol,
        eventType: event.eventType,
        entryPrice: event.entryPrice,
        currentPrice: event.currentPrice,
        peakPrice: event.peakPrice,
        pnlPct: event.pnlPct,
        peakGainPct: event.peakGainPct,
        triggerReason: event.triggerReason,
        metadata: (event.metadata as any) ?? null,
      },
    })
  } catch (e) {
    console.error('Failed to log risk event:', e)
  }
}

/**
 * Create a notification record.
 */
export async function createNotification(
  type: string,
  title: string,
  message: string,
  severity: string = 'info',
  symbol?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type,
        symbol: symbol ?? null,
        title,
        message,
        severity,
        metadata: (metadata as any) ?? null,
      },
    })
  } catch (e) {
    console.error('Failed to create notification:', e)
  }
}

/* ============================================================
 * ACCOUNT
 * ============================================================ */

export async function ensureAccount() {
  let account = await prisma.account.findUnique({ where: { id: 1 } })
  if (!account) {
    account = await prisma.account.create({
      data: {
        id: 1,
        balance: STARTING_BALANCE,
        startingEquity: STARTING_BALANCE,
        sipAmountInr: SIP_AMOUNT_INR,
        sipDayOfMonth: SIP_DAY_OF_MONTH,
        sipEligibleFrom: firstOfNextIstMonth(),
      },
    })
  } else {
    const updates: {
      sipDayOfMonth?: number
      sipEligibleFrom?: Date
    } = {}

    if (account.sipDayOfMonth !== SIP_DAY_OF_MONTH) {
      updates.sipDayOfMonth = SIP_DAY_OF_MONTH
    }

    if (!account.sipEligibleFrom) {
      // Backfill: if SIP already ran, stay eligible; otherwise start next IST month
      const alreadyStarted = !!(account.lastSipDate || (account.totalDeposited ?? 0) > 0)
      updates.sipEligibleFrom = alreadyStarted
        ? new Date('2000-01-01T00:00:00.000Z')
        : firstOfNextIstMonth()
    }

    if (Object.keys(updates).length > 0) {
      account = await prisma.account.update({
        where: { id: 1 },
        data: updates,
      })
    }
  }
  return account
}

/**
 * Reset portfolio to ₹1,00,000, clear open positions/pending orders,
 * and schedule SIP (₹20,000) from the subsequent IST month on sipDayOfMonth (e.g. 7th).
 * Closed trade history is kept for analytics.
 */
export async function resetPortfolio(): Promise<{
  balance: number
  sipEligibleFrom: Date
  sipDayOfMonth: number
  sipAmountInr: number
}> {
  await prisma.position.deleteMany()
  await prisma.order.deleteMany({ where: { status: 'pending' } })

  const sipEligibleFrom = firstOfNextIstMonth()
  const account = await prisma.account.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      balance: STARTING_BALANCE,
      startingEquity: STARTING_BALANCE,
      totalDeposited: 0,
      lastSipDate: null,
      sipAmountInr: SIP_AMOUNT_INR,
      sipDayOfMonth: SIP_DAY_OF_MONTH,
      sipEligibleFrom,
    },
    update: {
      balance: STARTING_BALANCE,
      startingEquity: STARTING_BALANCE,
      totalDeposited: 0,
      lastSipDate: null,
      sipAmountInr: SIP_AMOUNT_INR,
      sipDayOfMonth: SIP_DAY_OF_MONTH,
      sipEligibleFrom,
    },
  })

  await createNotification(
    'system',
    'Portfolio Reset',
    `Portfolio reset to ₹${STARTING_BALANCE.toLocaleString('en-IN')}. SIP of ₹${SIP_AMOUNT_INR.toLocaleString('en-IN')} starts on the ${SIP_DAY_OF_MONTH}th of next month (not this month).`,
    'info'
  )

  return {
    balance: account.balance,
    sipEligibleFrom: account.sipEligibleFrom!,
    sipDayOfMonth: account.sipDayOfMonth,
    sipAmountInr: account.sipAmountInr,
  }
}

/* ============================================================
 * SIP (Systematic Investment Plan) — monthly auto-deposit
 * ============================================================ */

/**
 * Deposit SIP on/after the configured IST day of month, once per IST month,
 * only after `sipEligibleFrom` (subsequent month after start/reset).
 *
 * @returns the amount deposited in INR, or 0 if no deposit was due.
 */
export async function processSipDeposit(): Promise<number> {
  const account = await ensureAccount()
  const now = new Date()
  const ist = getIstParts(now)
  const sipDay = account.sipDayOfMonth || SIP_DAY_OF_MONTH

  // Fixed calendar day (e.g. 7th) — not before that day in the month
  if (ist.day < sipDay) return 0

  // Not eligible until subsequent month after start/reset
  const eligibleFrom = account.sipEligibleFrom
    ? getIstParts(account.sipEligibleFrom)
    : null
  if (eligibleFrom) {
    if (
      ist.year < eligibleFrom.year ||
      (ist.year === eligibleFrom.year && ist.month < eligibleFrom.month)
    ) {
      return 0
    }
  }

  // Already deposited this IST month?
  if (account.lastSipDate) {
    const last = getIstParts(account.lastSipDate)
    if (last.year === ist.year && last.month === ist.month) return 0
  }

  const depositAmount = account.sipAmountInr || SIP_AMOUNT_INR

  await prisma.account.update({
    where: { id: 1 },
    data: {
      balance: { increment: depositAmount },
      totalDeposited: { increment: depositAmount },
      lastSipDate: now,
    },
  })

  await createNotification(
    'system',
    'SIP Deposit',
    `Monthly SIP of ₹${depositAmount.toLocaleString('en-IN')} added to your wallet (${sipDay}th IST).`,
    'info'
  )

  console.log(
    `[sip] Deposited ₹${depositAmount} — lastSipDate updated to ${now.toISOString()}`
  )

  return depositAmount
}
/**
 * Get the current market price (native currency — INR for Indian stocks).
 */
export async function getMarketPrice(symbol: string): Promise<number> {
  return getPrice(symbol)
}

/**
 * Get the raw native price (INR for Indian stocks).
 */
export async function getNativePrice(symbol: string): Promise<number> {
  return getPrice(symbol)
}

/* ============================================================
 * ORDER / FILL PROCESSING
 * ============================================================ */

export interface EntryContext {
  reason: string
  details?: Record<string, unknown>
}

export interface ExitContext {
  reason: string  // "trailing_stop" | "stop_loss" | "take_profit" | "signal_sell" | "manual"
  details?: Record<string, unknown>
}

export async function processMarketOrder(
  symbol: string,
  side: string,
  quantity: number
) {
  const price = await getMarketPrice(symbol)
  return processFill(symbol, side, quantity, price, null)
}

export async function processLimitOrder(
  symbol: string,
  side: string,
  quantity: number,
  limitPrice: number
) {
  const currentPrice = await getMarketPrice(symbol)

  let canFill = false
  if (side === 'buy' && currentPrice <= limitPrice) canFill = true
  if (side === 'sell' && currentPrice >= limitPrice) canFill = true

  if (canFill) {
    return processFill(symbol, side, quantity, limitPrice, null)
  }

  const order = await prisma.order.create({
    data: {
      symbol,
      side,
      type: 'limit',
      price: limitPrice,
      quantity,
      status: 'pending',
    },
  })

  return { order, filled: false }
}

/**
 * Core fill logic — creates a trade, updates position and balance.
 * Enhanced with entry/exit context tracking for full trade transparency.
 */
async function processFill(
  symbol: string,
  side: string,
  quantity: number,
  price: number,
  orderId: number | null,
  entryCtx?: EntryContext,
  exitCtx?: ExitContext
) {
  const account = await ensureAccount()

  // Whole shares only (allow exact full-close of a legacy fractional position)
  if (side === 'buy') {
    requireWholeShares(quantity)
  } else {
    const existingPos = await prisma.position.findUnique({ where: { symbol } })
    const isFullClose =
      existingPos != null && Math.abs(existingPos.quantity - quantity) < 1e-9
    if (!isFullClose) {
      requireWholeShares(quantity)
    }
  }

  const cost = price * quantity
  const cashReserve = account.startingEquity * CASH_RESERVE_PCT

  if (side === 'buy') {
    if (cost > account.balance) {
      throw new Error('Insufficient balance')
    }
    // Minimum balance / cash-reserve guardrail before any investment
    if (account.balance - cost < cashReserve) {
      throw new Error(
        `Minimum balance rule: must keep ₹${cashReserve.toLocaleString('en-IN')} (${CASH_RESERVE_PCT * 100}% of starting equity) in the wallet`
      )
    }

    await prisma.account.update({
      where: { id: 1 },
      data: { balance: { decrement: cost } },
    })

    const existing = await prisma.position.findUnique({ where: { symbol } })
    if (existing) {
      const totalQty = existing.quantity + quantity
      const newEntry =
        (existing.entryPrice * existing.quantity + price * quantity) / totalQty
      await prisma.position.update({
        where: { symbol },
        data: {
          entryPrice: newEntry,
          quantity: totalQty,
          peakPrice: Math.max(existing.peakPrice, price),
          troughPrice: existing.troughPrice > 0 ? Math.min(existing.troughPrice, price) : price,
        },
      })
    } else {
      await prisma.position.create({
        data: {
          symbol,
          side: 'long',
          entryPrice: price,
          quantity,
          peakPrice: price,
          troughPrice: price,
        },
      })

      // Log entry event
      await logRiskEvent({
        symbol,
        eventType: 'entry',
        entryPrice: price,
        currentPrice: price,
        peakPrice: price,
        pnlPct: 0,
        peakGainPct: 0,
        triggerReason: entryCtx?.reason || 'manual',
        metadata: entryCtx?.details,
      })

      // Create notification for new position
      await createNotification(
        'trade_open',
        `Position Opened: ${symbol}`,
        `Bought ${quantity} @ ₹${price.toFixed(2)} — ${entryCtx?.reason || 'Manual buy'}`,
        'info',
        symbol,
        entryCtx?.details
      )
    }
  } else {
    // sell
    const existing = await prisma.position.findUnique({ where: { symbol } })
    if (!existing || existing.quantity < quantity) {
      throw new Error('Insufficient position to sell')
    }

    const proceeds = price * quantity
    const sellPenalty = SELL_PENALTY_FLAT // flat ₹150 money lost permanently
    const netProceeds = proceeds - sellPenalty
    const remaining = existing.quantity - quantity
    const costBasis = existing.entryPrice * quantity
    const pnl = netProceeds - costBasis

    await prisma.account.update({
      where: { id: 1 },
      data: { balance: { increment: netProceeds } },
    })

    if (remaining <= 0) {
      await prisma.position.delete({ where: { symbol } })

      const holdDuration = Math.round(
        (Date.now() - existing.createdAt.getTime()) / (1000 * 60)
      )
      const peakGainPct = existing.peakPrice > 0
        ? ((existing.peakPrice - existing.entryPrice) / existing.entryPrice) * 100
        : 0
      const exitPnlPct = ((price - existing.entryPrice) / existing.entryPrice) * 100
      // Proper MAE from tracked trough price
      const adversePct = existing.troughPrice > 0
        ? Math.min(0, ((existing.troughPrice - existing.entryPrice) / existing.entryPrice) * 100)
        : Math.min(0, exitPnlPct)

      const closedTrade = await prisma.customStrategyTrade.create({
        data: {
          symbol,
          side: 'long',
          entryPrice: existing.entryPrice,
          exitPrice: price,
          quantity: existing.quantity,
          pnl,
          pnlPct: exitPnlPct,
          openedAt: existing.createdAt,
          exitReason: exitCtx?.reason || 'manual',
          exitDetails: (exitCtx?.details as any) ?? undefined,
          entryReason: entryCtx?.reason || 'manual',
          entryDetails: (entryCtx?.details as any) ?? undefined,
          maxFavorable: peakGainPct,
          maxAdverse: adversePct,
          holdDuration,
        },
      })

      // Log exit event
      await logRiskEvent({
        tradeId: closedTrade.id,
        symbol,
        eventType: exitCtx?.reason || 'manual',
        entryPrice: existing.entryPrice,
        currentPrice: price,
        peakPrice: existing.peakPrice,
        pnlPct: exitPnlPct,
        peakGainPct,
        triggerReason: exitCtx?.reason || 'Manual close',
        metadata: exitCtx?.details,
      })

      // Create notification
      const pnlStr = pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`
      await createNotification(
        'trade_close',
        `Position Closed: ${symbol}`,
        `Closed ${existing.quantity} @ ₹${price.toFixed(2)} — P&L: ${pnlStr} (${exitPnlPct.toFixed(1)}%) — ${exitCtx?.reason || 'Manual'}`,
        pnl >= 0 ? 'success' : 'warning',
        symbol,
        { pnl, pnlPct: exitPnlPct, ...exitCtx?.details }
      )
    } else {
      await prisma.position.update({
        where: { symbol },
        data: { quantity: remaining },
      })
    }
  }

  const trade = await prisma.trade.create({
    data: {
      orderId,
      symbol,
      side,
      price,
      quantity,
    },
  })

  if (orderId) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'filled' },
    })
  }

  return { trade, filled: true }
}

/**
 * Close a position at market price with exit context.
 */
export async function closePositionAtMarket(
  symbol: string,
  exitCtx?: ExitContext,
  partialQty?: number
) {
  const position = await prisma.position.findUnique({ where: { symbol } })
  if (!position) throw new Error(`No open position for ${symbol}`)
  const sellQty = partialQty ? Math.min(partialQty, position.quantity) : position.quantity
  return processFill(
    symbol,
    'sell',
    sellQty,
    await getMarketPrice(symbol),
    null,
    undefined,
    exitCtx ?? { reason: 'manual' }
  )
}

export async function checkPendingOrders() {
  const pending = await prisma.order.findMany({
    where: { status: 'pending' },
  })

  for (const order of pending) {
    try {
      const currentPrice = await getMarketPrice(order.symbol)
      let canFill = false
      if (order.side === 'buy' && currentPrice <= order.price) canFill = true
      if (order.side === 'sell' && currentPrice >= order.price) canFill = true

      if (canFill) {
        await processFill(order.symbol, order.side, order.quantity, order.price, order.id)
      }
    } catch {
      // Skip if price fetch fails
    }
  }
}

/* ============================================================
 * RISK MANAGEMENT
 * ============================================================ */

export interface RiskStatus {
  totalEquity: number
  startingEquity: number
  totalDeposited: number
  investedCapital: number
  totalPnl: number
  drawdownPct: number
  cashAvailable: number
  cashPct: number
  positionsCount: number
  positionsRisked: number
  dailyPnl: number
  circuitBreakerActive: boolean
  maxPositionsAllowed: number | null
  maxRiskPerTradePct: number
}

/**
 * Calculate the current risk status of the portfolio.
 */
export async function getRiskStatus(): Promise<RiskStatus> {
  const account = await ensureAccount()
  const positions = await prisma.position.findMany()

  let positionsValue = 0
  for (const p of positions) {
    try {
      const price = await getMarketPrice(p.symbol)
      positionsValue += price * p.quantity
    } catch {
      positionsValue += p.entryPrice * p.quantity
    }
  }

  const totalEquity = account.balance + positionsValue
  // SIP deposits are capital, not profit — measure vs invested capital
  let totalDeposited = account.totalDeposited ?? 0
  if (totalDeposited <= 0 && account.lastSipDate) {
    totalDeposited = account.sipAmountInr
  }
  const investedCapital = account.startingEquity + totalDeposited
  const totalPnl = totalEquity - investedCapital
  const drawdownPct = investedCapital > 0
    ? ((investedCapital - totalEquity) / investedCapital) * 100
    : 0

  // Today's closed trades for daily P&L
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTrades = await prisma.customStrategyTrade.findMany({
    where: { closedAt: { gte: todayStart } },
  })
  const dailyPnl = todayTrades.reduce((s, t) => s + t.pnl, 0)

  return {
    totalEquity,
    startingEquity: account.startingEquity,
    totalDeposited,
    investedCapital,
    totalPnl,
    drawdownPct,
    cashAvailable: account.balance,
    cashPct: totalEquity > 0 ? (account.balance / totalEquity) * 100 : 0,
    positionsCount: positions.length,
    positionsRisked: positionsValue,
    dailyPnl,
    // Circuit breaker: stop new buys if drawdown > 6% or daily loss > 2.5%
    circuitBreakerActive: drawdownPct > 6 || dailyPnl < -(totalEquity * 0.025),
    maxPositionsAllowed: null as number | null, // unlimited
    maxRiskPerTradePct: 35, // high-confidence sizing can use up to ~35% of equity
  }
}

/**
 * Structured risk check result with typed exit reason.
 */
export interface RiskCheckResult {
  shouldClose: boolean
  shouldPartialClose?: boolean
  reason: string
  reasonType: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'signal_sell' | 'breakeven_exit' | 'time_exit' | 'partial_profit' | 'none'
  details?: Record<string, unknown>
}

/**
 * Check if a position should be closed for risk management:
 * - Hard stop-loss at -7% from entry (widened from -5% to avoid noise-triggered exits)
 * - Partial profit at +5% (sell 50%, move stop to breakeven)
 * - Take-profit at +15% from entry (let winners run further)
 * - Trailing stop: once position reaches +7%, protect 60% of peak gain
 * - Time-based exit: close after 10 days if no significant move
 */
export async function shouldCloseForRisk(
  symbol: string,
  entryPrice: number,
  currentPrice: number,
  signal: 'BUY' | 'SELL' | 'HOLD',
  peakPrice: number,
  position?: { quantity: number; createdAt: Date; partialExitTaken?: boolean }
): Promise<RiskCheckResult> {
  const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100

  // --- 1. Hard stop-loss: -7% (widened to survive normal NSE volatility) ---
  if (pnlPct <= -7) {
    return {
      shouldClose: true,
      reason: `Stop-loss triggered at ${pnlPct.toFixed(1)}%`,
      reasonType: 'stop_loss',
      details: {
        entryPrice,
        currentPrice,
        pnlPct,
        threshold: -7,
        protectionType: 'hard_stop_loss',
      },
    }
  }

  // --- 2. Partial profit at +5% (sell half, move stop to breakeven) ---
  if (pnlPct >= 5 && !(position?.partialExitTaken)) {
    return {
      shouldClose: false,
      shouldPartialClose: true,
      reason: `Partial profit at +${pnlPct.toFixed(1)}% — selling 50%, moving stop to breakeven`,
      reasonType: 'partial_profit',
      details: {
        entryPrice,
        currentPrice,
        pnlPct,
        sellFraction: 0.5,
        protectionType: 'partial_profit',
      },
    }
  }

  // --- 3. Breakeven stop: if partial exit already taken, exit if price drops below entry ---
  if (position?.partialExitTaken && pnlPct <= 0) {
    return {
      shouldClose: true,
      reason: `Breakeven exit at ${pnlPct.toFixed(1)}% after partial profit taken`,
      reasonType: 'breakeven_exit',
      details: {
        entryPrice,
        currentPrice,
        pnlPct,
        protectionType: 'breakeven_stop',
      },
    }
  }

  // --- 4. Take-profit: +15% (let winners run, not just +10%) ---
  if (pnlPct >= 15) {
    return {
      shouldClose: true,
      reason: `Take-profit hit at +${pnlPct.toFixed(1)}%`,
      reasonType: 'take_profit',
      details: {
        entryPrice,
        currentPrice,
        pnlPct,
        threshold: 15,
        protectionType: 'take_profit',
      },
    }
  }

  // --- 5. Trailing stop: once above +7%, protect 60% of peak gain ---
  const peakGainPct = peakPrice > 0 ? ((peakPrice - entryPrice) / entryPrice) * 100 : 0
  if (peakGainPct >= 7 && pnlPct < peakGainPct * 0.4) {
    return {
      shouldClose: true,
      reason: `Trailing stop — peaked at +${peakGainPct.toFixed(1)}%, now at ${pnlPct.toFixed(1)}% (locked +${(peakGainPct * 0.4).toFixed(1)}%)`,
      reasonType: 'trailing_stop',
      details: {
        entryPrice,
        currentPrice,
        peakPrice,
        pnlPct,
        peakGainPct,
        protectedGain: peakGainPct * 0.4,
        trailingStopPct: peakGainPct * 0.4,
        protectionType: 'trailing_stop',
      },
    }
  }

  // --- 6. Time-based exit: close after 10 days if position is stagnant ---
  if (position?.createdAt) {
    const daysHeld = (Date.now() - position.createdAt.getTime()) / 86400000
    if (daysHeld >= 10 && Math.abs(pnlPct) < 3) {
      return {
        shouldClose: true,
        reason: `Time exit — held ${daysHeld.toFixed(0)} days with only ${pnlPct.toFixed(1)}% move. Freeing capital.`,
        reasonType: 'time_exit',
        details: {
          entryPrice,
          currentPrice,
          pnlPct,
          daysHeld: Math.round(daysHeld),
          protectionType: 'time_exit',
        },
      }
    }
  }

  // --- 7. Strategy signal to sell ---
  if (signal === 'SELL') {
    return {
      shouldClose: true,
      reason: 'Strategy SELL signal',
      reasonType: 'signal_sell',
      details: {
        entryPrice,
        currentPrice,
        pnlPct,
        protectionType: 'strategy_signal',
      },
    }
  }

  return { shouldClose: false, reason: '', reasonType: 'none' }
}

/* ============================================================
 * AUTO TRADING ENGINE
 * ============================================================ */

export interface AutoTradeResult {
  instrument: string
  signal: string
  action: string
  detail: string
  pnl?: number
  pnlPct?: number
}

/**
 * Smart auto-trading with full risk management and trade transparency.
 */
export async function runAutoTrade(): Promise<AutoTradeResult[]> {
  const { generateMultiStrategySignal } = await import('./strategy')
  const { calculateConfidenceScore } = await import('./ml/confidence')
  const results: AutoTradeResult[] = []

  // --- 0a. Monthly SIP (fixed IST day, starting subsequent month after reset) ---
  try {
    const deposited = await processSipDeposit()
    if (deposited > 0) {
      results.push({
        instrument: 'PORTFOLIO',
        signal: 'HOLD',
        action: 'SIP_DEPOSIT',
        detail: `SIP deposited ₹${deposited.toLocaleString('en-IN')} into wallet.`,
      })
    }
  } catch (e) {
    console.error('[sip] processSipDeposit failed:', e)
  }

  // --- 0b. Check circuit breaker ---
  const risk = await getRiskStatus()

  // --- 1. Risk-manage existing positions FIRST (stop-loss, take-profit, trailing stop) ---
  const positions = await prisma.position.findMany()

  for (const pos of positions) {
    try {
      const currentPrice = await getMarketPrice(pos.symbol)
      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
      const pnl = (currentPrice - pos.entryPrice) * pos.quantity

      // Update peak/trough price for MFE/MAE tracking
      const updateData: { peakPrice?: number; troughPrice?: number } = {}
      if (currentPrice > pos.peakPrice) {
        updateData.peakPrice = currentPrice
      }
      if (pos.troughPrice === 0 || currentPrice < pos.troughPrice) {
        updateData.troughPrice = currentPrice
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.position.update({
          where: { id: pos.id },
          data: updateData,
        })
        if (updateData.peakPrice) pos.peakPrice = updateData.peakPrice
        if (updateData.troughPrice) pos.troughPrice = updateData.troughPrice
      }

      // Log peak update event when significant (new high watermark)
      if (updateData.peakPrice) {
        const oldPeak = pos.peakPrice
        const peakGainPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
        if (peakGainPct >= 5 && oldPeak > 0) {
          await logRiskEvent({
            symbol: pos.symbol,
            eventType: 'peak_update',
            entryPrice: pos.entryPrice,
            currentPrice,
            peakPrice: currentPrice,
            pnlPct,
            peakGainPct,
            triggerReason: `New peak: +${peakGainPct.toFixed(1)}% (trailing stop protecting +${(peakGainPct * 0.4).toFixed(1)}%)`,
            metadata: { oldPeak, newPeak: currentPrice },
          })
        }
      }

      // Generate multi-strategy signal for held position
      let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD'
      let strategyDetail = ''
      try {
        const sig = await generateMultiStrategySignal(pos.symbol)
        signal = sig.signal
        strategyDetail = sig.strategies
          ? ` [${sig.strategies.filter(s => s.signal !== 'HOLD').map(s => `${s.name}:${s.signal}`).join(', ')}]`
          : ''
      } catch {
        // If signal fails, rely on pure risk rules
      }

      const riskCheck = await shouldCloseForRisk(
        pos.symbol, pos.entryPrice, currentPrice, signal, pos.peakPrice,
        { quantity: pos.quantity, createdAt: pos.createdAt, partialExitTaken: pos.partialExitTaken }
      )

      // Handle partial profit taking (sell ~50% in whole shares; need ≥2 shares)
      if (riskCheck.shouldPartialClose && !pos.partialExitTaken) {
        const sellQty = Math.floor(pos.quantity / 2)
        if (sellQty >= 1) {
          await closePositionAtMarket(pos.symbol, {
            reason: 'partial_profit',
            details: {
              ...riskCheck.details,
              reasonText: riskCheck.reason,
              strategyDetail,
              soldFraction: 0.5,
              remainingQty: pos.quantity - sellQty,
            },
          }, sellQty)
          // Mark partial exit taken so trailing/breakeven rules know
          await prisma.position.update({
            where: { id: pos.id },
            data: { partialExitTaken: true },
          })
          const partialPnl = (currentPrice - pos.entryPrice) * sellQty
          results.push({
            instrument: pos.symbol,
            signal,
            action: 'PARTIAL_SOLD',
            detail: `${riskCheck.reason} — sold ${sellQty} @ ₹${currentPrice.toFixed(2)}, P&L ₹${partialPnl.toFixed(2)}${strategyDetail}`,
            pnl: partialPnl,
            pnlPct,
          })
          await logRiskEvent({
            symbol: pos.symbol,
            eventType: 'partial_profit',
            entryPrice: pos.entryPrice,
            currentPrice,
            peakPrice: pos.peakPrice,
            pnlPct,
            peakGainPct: ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100,
            triggerReason: riskCheck.reason,
            metadata: riskCheck.details,
          })
        }
      }

      if (riskCheck.shouldClose) {
        await closePositionAtMarket(pos.symbol, {
          reason: riskCheck.reasonType,
          details: {
            ...riskCheck.details,
            reasonText: riskCheck.reason,
            strategyDetail,
          },
        })
        results.push({
          instrument: pos.symbol,
          signal,
          action: 'SOLD',
          detail: `${riskCheck.reason} — closed ${pos.quantity} @ ₹${currentPrice.toFixed(2)}${strategyDetail}`,
          pnl,
          pnlPct,
        })

        // Log detailed risk event for this trigger
        const peakGainPct = pos.peakPrice > 0
          ? ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100
          : 0
        await logRiskEvent({
          symbol: pos.symbol,
          eventType: riskCheck.reasonType,
          entryPrice: pos.entryPrice,
          currentPrice,
          peakPrice: pos.peakPrice,
          pnlPct,
          peakGainPct,
          triggerReason: riskCheck.reason,
          metadata: riskCheck.details,
        })

        // Create notification for risk-triggered exit
        const severity = riskCheck.reasonType === 'stop_loss' ? 'danger'
          : riskCheck.reasonType === 'take_profit' ? 'success'
          : riskCheck.reasonType === 'trailing_stop' ? 'success'
          : 'info'
        await createNotification(
          'risk_event',
          `${riskCheck.reasonType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${pos.symbol}`,
          `${riskCheck.reason} — P&L: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`,
          severity,
          pos.symbol,
          { pnl, pnlPct, reason: riskCheck.reasonType, ...riskCheck.details }
        )
      }
    } catch {
      // Skip if price fetch fails
    }
  }

  // --- 2. Check circuit breaker before buying ---
  if (risk.circuitBreakerActive) {
    results.push({
      instrument: 'PORTFOLIO',
      signal: 'HOLD',
      action: 'CIRCUIT_BREAKER',
      detail: `Circuit breaker active — drawdown ${risk.drawdownPct.toFixed(1)}%, daily P&L ₹${risk.dailyPnl.toFixed(0)}. No new buys.`,
    })
    return results
  }

  // --- 3. Load open positions (no hard position-count cap) ---
  const activePositions = await prisma.position.findMany()

  // --- 4. Scan all instruments for buy signals ---
  const account = await ensureAccount()

  // Keep 30% of starting equity as minimum wallet balance (cash reserve)
  const cashReserve = account.startingEquity * CASH_RESERVE_PCT
  let remainingBalance = account.balance
  let investableCash = Math.max(0, remainingBalance - cashReserve)

  if (remainingBalance < cashReserve || investableCash < MIN_INVESTABLE_CASH) {
    results.push({
      instrument: 'PORTFOLIO',
      signal: 'HOLD',
      action: 'LOW_CASH',
      detail: `Minimum balance rule: need ₹${cashReserve.toLocaleString('en-IN')} reserve + investable cash (have ₹${remainingBalance.toFixed(0)}, investable ₹${investableCash.toFixed(0)}). Waiting.`,
    })
    return results
  }

  // Collect all buy signals
  const buyCandidates: Array<{
    symbol: string
    confidence: number
    aiConfidence: number | null
    price: number
    signal: Awaited<ReturnType<typeof generateMultiStrategySignal>>
    aiScore: Awaited<ReturnType<typeof calculateConfidenceScore>> | null
  }> = []

  for (const inst of INSTRUMENTS) {
    // Skip if already holding
    const existing = activePositions.find((p) => p.symbol === inst.symbol)
    if (existing) continue

    // Only trade Indian equities (skip US stocks + index)
    if (!TRADABLE_STOCKS.has(inst.symbol)) continue

    try {
      const sig = await generateMultiStrategySignal(inst.symbol)
      if (sig.signal === 'BUY') {
        // REJECT overbought entries — buying at RSI > 70 is a losing trade
        if (sig.indicators && sig.indicators.rsi14 > 70) continue

        // No fixed score gate: any BUY signal is eligible.
        // Confidence only scales position size (low → small, high → large).
        const aiScore = await calculateConfidenceScore(inst.symbol)
        const aiConfidence = aiScore?.overallConfidence ?? null
        const effectiveConfidence = aiConfidence !== null ? aiConfidence : sig.confidence

        buyCandidates.push({
          symbol: inst.symbol,
          confidence: effectiveConfidence,
          aiConfidence,
          price: sig.price,
          signal: sig,
          aiScore,
        })
      }
    } catch {
      // Skip on error
    }
  }

  // Sort by confidence (highest first) — larger scores get bought first / sized larger
  buyCandidates.sort((a, b) => b.confidence - a.confidence)

  // --- 5. Execute buys for all candidates while cash allows (no position count / ₹ caps) ---
  for (const candidate of buyCandidates) {
    investableCash = Math.max(0, remainingBalance - cashReserve)
    if (investableCash < MIN_INVESTABLE_CASH) break

    const price = await getMarketPrice(candidate.symbol)
    const { qty, allocation, allocationPct } = sizePosition({
      totalEquity: risk.totalEquity,
      confidence: candidate.confidence,
      investableCash,
      price,
    })

    if (qty < 1) continue

    try {
        const stratNames = candidate.signal.strategies
          ? candidate.signal.strategies.filter(s => s.signal === 'BUY').map(s => s.name).join('+')
          : 'multi-strategy'

        // Determine entry reason from the signal
        const _strategyName = candidate.signal.strategies?.find(s => s.signal === 'BUY')?.name || ''
        let entryReason: string
        if (candidate.signal.strategyCount && candidate.signal.strategyCount >= 2) {
          entryReason = 'consensus'
        } else if (_strategyName.toLowerCase().includes('kronos')) {
          entryReason = 'kronos'
        } else {
          entryReason = _strategyName.toLowerCase().replace(/\s+/g, '_') || 'multi-strategy'
        }

        await processFill(
          candidate.symbol, 'buy', qty, price, null,
          {
            reason: entryReason,
            details: {
              confidence: candidate.confidence,
              strategyConfidence: candidate.signal.confidence,
              aiConfidence: candidate.aiConfidence,
              aiComponents: candidate.aiScore ? {
                strategy: candidate.aiScore.components.strategyAgreement.score,
                ml: candidate.aiScore.components.mlPrediction.score,
                kronos: candidate.aiScore.components.kronosAI.score,
                regime: candidate.aiScore.components.marketRegime.score,
                winRate: candidate.aiScore.components.historicalWinRate.score,
                scanner: null,
              } : null,
              recommendation: candidate.aiScore?.recommendation ?? null,
              strategyCount: candidate.signal.strategyCount,
              agreeingStrategies: candidate.signal.strategies
                ?.filter(s => s.signal === 'BUY')
                .map(s => ({ name: s.name, reason: s.reason })),
              stopLoss: candidate.signal.stopLoss,
              takeProfit: candidate.signal.takeProfit,
              riskReward: candidate.signal.riskReward,
              atr: candidate.signal.atr,
              indicators: candidate.signal.indicators,
              allocationPct,
              maxAllocationCap: null,
            },
          }
        )
        remainingBalance -= allocation
        results.push({
          instrument: candidate.symbol,
          signal: 'BUY',
          action: 'BOUGHT',
          detail: `Bought ${qty} @ ₹${price.toFixed(2)} (₹${allocation.toFixed(0)}, conf ${candidate.confidence}%${candidate.aiConfidence !== null ? ` [AI: ${candidate.aiConfidence}%]` : ''}, ${stratNames}). SL: ₹${candidate.signal.stopLoss?.toFixed(2) ?? 'N/A'}, TP: ₹${candidate.signal.takeProfit?.toFixed(2) ?? 'N/A'}`,
        })
      } catch {
        // Skip on error (e.g. min-balance race)
      }
  }

  // If nothing happened, note it
  if (results.length === 0) {
    results.push({
      instrument: 'PORTFOLIO',
      signal: 'HOLD',
      action: 'NO_SIGNALS',
      detail: 'No actionable signals. Portfolio is safe.',
    })
  }

  return results
}

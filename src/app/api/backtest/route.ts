import { NextRequest, NextResponse } from 'next/server'
import { runBacktest, saveBacktest, listBacktests, type BacktestConfig } from '@/lib/backtest'
import { INSTRUMENTS } from '@/types'

/**
 * POST /api/backtest — run a new backtest
 * Body: { startDate, endDate, symbols?, name?, startingCapital? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { startDate, endDate, symbols, name, startingCapital } = body

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required (ISO date strings)' },
        { status: 400 }
      )
    }

    // Default: all tradable NIFTY 50 stocks (INR, excluding index)
    const symbolList: string[] = symbols && Array.isArray(symbols) && symbols.length > 0
      ? symbols
      : INSTRUMENTS
          .filter((i) => i.currency === 'INR' && i.symbol !== 'NIFTY50')
          .map((i) => i.symbol)

    const config: BacktestConfig = {
      symbols: symbolList,
      startDate,
      endDate,
      startingCapital: startingCapital || 100000,
      name: name || `Backtest ${startDate.slice(0, 10)} → ${endDate.slice(0, 10)}`,
    }

    // Run the backtest (this is CPU-intensive, may take 10-60s)
    const metrics = await runBacktest(config)

    // Persist to DB
    const id = await saveBacktest(config, metrics)

    return NextResponse.json({ id, ...metrics })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * GET /api/backtest — list all past backtests
 */
export async function GET() {
  try {
    const backtests = await listBacktests()
    return NextResponse.json(backtests)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

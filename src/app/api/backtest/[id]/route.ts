import { NextRequest, NextResponse } from 'next/server'
import { getBacktest } from '@/lib/backtest'

/**
 * GET /api/backtest/[id] — retrieve a specific backtest with all trades
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const backtestId = parseInt(id, 10)
    if (isNaN(backtestId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const backtest = await getBacktest(backtestId)
    if (!backtest) {
      return NextResponse.json({ error: 'Backtest not found' }, { status: 404 })
    }

    return NextResponse.json(backtest)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

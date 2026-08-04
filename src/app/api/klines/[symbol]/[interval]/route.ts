import { NextRequest, NextResponse } from 'next/server'
import { getKlines } from '@/lib/market'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string; interval: string }> }
) {
  try {
    const { symbol, interval } = await params

    // Choose appropriate range based on interval
    const rangeMap: Record<string, string> = {
      '15m': '5d',
      '60m': '1mo',
      '1d': '6mo',
      '1wk': '2y',
    }
    const range = rangeMap[interval] || '3mo'

    const klines = await getKlines(symbol, interval, range)

    return NextResponse.json({ data: klines })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch klines'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { closePositionAtMarket } from '@/lib/trading'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { symbol } = body

    if (!symbol) {
      return NextResponse.json({ error: 'Symbol required' }, { status: 400 })
    }

    const result = await closePositionAtMarket(symbol)
    return NextResponse.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to close position'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

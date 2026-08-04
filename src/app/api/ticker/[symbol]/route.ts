import { NextRequest, NextResponse } from 'next/server'
import { getNativePrice } from '@/lib/trading'
import { getInstrument } from '@/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params
    const inst = getInstrument(symbol)
    const nativePrice = await getNativePrice(symbol)

    return NextResponse.json({
      data: {
        symbol,
        price: nativePrice,   // Native currency (INR for Indian stocks)
        nativePrice,          // Same — no conversion
        currency: inst?.currency ?? 'INR',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 500 })
  }
}

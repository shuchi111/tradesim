import { NextResponse } from 'next/server'
import { generateAllSignals } from '@/lib/strategy'
import { INSTRUMENTS } from '@/types'

export async function GET() {
  try {
    const symbols = INSTRUMENTS.map((i) => i.symbol)
    const signals = await generateAllSignals(symbols)
    return NextResponse.json({ data: signals })
  } catch {
    return NextResponse.json({ error: 'Failed to generate signals' }, { status: 500 })
  }
}

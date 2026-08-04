import { NextResponse } from 'next/server'
import { runAutoTrade } from '@/lib/trading'

export async function POST() {
  try {
    const results = await runAutoTrade()
    return NextResponse.json({ data: results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Auto-trade failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { getRiskStatus } from '@/lib/trading'

export async function GET() {
  try {
    const status = await getRiskStatus()
    return NextResponse.json({ data: status })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch risk status' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { SCANNER_URL } from '@/lib/agent-analysis'

export async function GET() {
  try {
    const resp = await fetch(`${SCANNER_URL}/api/agents`, { cache: 'no-store' })
    if (!resp.ok) {
      return NextResponse.json(
        { error: 'Scanner unavailable', agents: [] },
        { status: 503 }
      )
    }
    return NextResponse.json(await resp.json())
  } catch {
    return NextResponse.json(
      { error: 'Scanner unavailable. Start it with: npm run scanner', agents: [] },
      { status: 503 }
    )
  }
}

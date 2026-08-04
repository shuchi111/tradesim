import { NextResponse } from 'next/server'
import { calculateConfidenceScore } from '@/lib/ml/confidence'

/**
 * GET /api/confidence/:symbol
 * Returns the composite confidence score for a symbol.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params

  try {
    const result = await calculateConfidenceScore(symbol)
    if (!result) {
      return NextResponse.json(
        { error: 'Insufficient data for confidence score' },
        { status: 400 }
      )
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Confidence calculation failed' },
      { status: 500 }
    )
  }
}

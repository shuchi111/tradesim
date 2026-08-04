import { NextResponse } from 'next/server'
import { extractFeatures, heuristicPrediction } from '@/lib/ml/features'

/**
 * GET /api/ml/predict/:symbol
 * Returns ML-style prediction for a symbol using heuristic feature analysis.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params

  try {
    const featureResult = await extractFeatures(symbol)
    if (!featureResult) {
      return NextResponse.json(
        { error: 'Insufficient data for prediction' },
        { status: 400 }
      )
    }

    const prediction = heuristicPrediction(featureResult.features)

    return NextResponse.json({
      symbol,
      price: featureResult.price,
      ...prediction,
      features: featureResult.features,
      indicators: featureResult.indicators,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Prediction failed' },
      { status: 500 }
    )
  }
}

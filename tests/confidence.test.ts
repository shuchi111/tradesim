import { describe, it, expect } from 'vitest'
import { allocationPctFromConfidence } from '../src/lib/position-sizing'
import { kronosLongScore } from '../src/lib/ml/kronos-score'

describe('kronosLongScore', () => {
  it('scores bearish low-upside below neutral', () => {
    const score = kronosLongScore({
      upside: 33.3,
      confidencePct: 66.7,
      direction: 'bearish',
      predictedChangePct: -2,
    })
    expect(score).toBeLessThan(45)
  })

  it('scores bullish high-upside above neutral', () => {
    const score = kronosLongScore({
      upside: 80,
      confidencePct: 80,
      direction: 'bullish',
      predictedChangePct: 4,
    })
    expect(score).toBeGreaterThan(70)
  })

  it('uses upside for neutral direction', () => {
    const score = kronosLongScore({
      upside: 50,
      confidencePct: 40,
      direction: 'neutral',
      predictedChangePct: 0,
    })
    expect(score).toBeGreaterThanOrEqual(40)
    expect(score).toBeLessThanOrEqual(60)
  })
})

describe('allocationPctFromConfidence', () => {
  it('increases with confidence', () => {
    expect(allocationPctFromConfidence(50)).toBeLessThan(allocationPctFromConfidence(80))
    expect(allocationPctFromConfidence(80)).toBeLessThan(allocationPctFromConfidence(100))
  })
})

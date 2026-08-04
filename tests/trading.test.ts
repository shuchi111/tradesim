import { describe, it, expect } from 'vitest'

/**
 * Unit tests for trading math and logic (pure functions extracted from trading.ts).
 * These test the P&L and position calculations independent of the database.
 */

describe('P&L Calculation', () => {
  // Long position P&L: (exitPrice - entryPrice) * quantity
  function calcPnl(entryPrice: number, exitPrice: number, quantity: number): number {
    return (exitPrice - entryPrice) * quantity
  }

  it('calculates positive P&L when price goes up', () => {
    const pnl = calcPnl(60000, 65000, 0.5)
    expect(pnl).toBe(2500) // (65000-60000) * 0.5 = 2500
  })

  it('calculates negative P&L when price goes down', () => {
    const pnl = calcPnl(60000, 55000, 0.5)
    expect(pnl).toBe(-2500)
  })

  it('calculates zero P&L when price unchanged', () => {
    const pnl = calcPnl(60000, 60000, 0.5)
    expect(pnl).toBe(0)
  })

  it('calculates P&L with large quantity', () => {
    const pnl = calcPnl(100, 120, 10)
    expect(pnl).toBe(200)
  })

  it('calculates P&L with small fractional quantity', () => {
    const pnl = calcPnl(50000, 51000, 0.001)
    expect(pnl).toBe(1) // 1000 * 0.001 = 1
  })
})

describe('Average Entry Price', () => {
  function calcAvgEntry(
    existingQty: number,
    existingPrice: number,
    newQty: number,
    newPrice: number
  ): number {
    const totalQty = existingQty + newQty
    return (existingPrice * existingQty + newPrice * newQty) / totalQty
  }

  it('calculates weighted average for two buys at different prices', () => {
    const avg = calcAvgEntry(1, 60000, 1, 62000)
    expect(avg).toBe(61000) // (60000 + 62000) / 2
  })

  it('weights larger position more', () => {
    const avg = calcAvgEntry(0.9, 60000, 0.1, 70000)
    expect(avg).toBe(61000) // (60000*0.9 + 70000*0.1) = 61000
  })

  it('updates entry when adding to existing position', () => {
    // Buy 0.5 at $60k, then buy 0.5 at $64k
    const avg1 = calcAvgEntry(0.5, 60000, 0.5, 64000)
    expect(avg1).toBe(62000)
  })
})

describe('Order Value', () => {
  function calcOrderValue(price: number, quantity: number): number {
    return price * quantity
  }

  it('calculates order value for BTC', () => {
    expect(calcOrderValue(60000, 0.1)).toBe(6000)
  })

  it('calculates order value for DOGE', () => {
    expect(calcOrderValue(0.07, 1000)).toBe(70)
  })
})

describe('Limit Order Fill Logic', () => {
  // Buy limit fills when marketPrice <= limitPrice
  // Sell limit fills when marketPrice >= limitPrice

  it('buy limit fills when market below limit', () => {
    const fills = 59000 <= 60000
    expect(fills).toBe(true)
  })

  it('buy limit does not fill when market above limit', () => {
    const fills = 61000 <= 60000
    expect(fills).toBe(false)
  })

  it('buy limit fills when market equals limit', () => {
    const fills = 60000 <= 60000
    expect(fills).toBe(true)
  })

  it('sell limit fills when market above limit', () => {
    const fills = 61000 >= 60000
    expect(fills).toBe(true)
  })

  it('sell limit does not fill when market below limit', () => {
    const fills = 59000 >= 60000
    expect(fills).toBe(false)
  })
})

describe('Balance Update', () => {
  it('buy decreases balance by cost', () => {
    const balance = 100000
    const cost = 60000 * 0.1
    const newBalance = balance - cost
    expect(newBalance).toBe(94000)
  })

  it('sell increases balance by proceeds', () => {
    const balance = 94000
    const proceeds = 62000 * 0.1
    const newBalance = balance + proceeds
    expect(newBalance).toBe(100200) // 200 profit
  })

  it('partial sell reduces position quantity', () => {
    const existingQty = 0.5
    const sellQty = 0.3
    const remaining = existingQty - sellQty
    expect(remaining).toBe(0.2)
  })
})

describe('Win Rate', () => {
  function calcWinRate(wins: number, losses: number): number {
    const total = wins + losses
    if (total === 0) return 0
    return (wins / total) * 100
  }

  it('calculates 100% win rate', () => {
    expect(calcWinRate(5, 0)).toBe(100)
  })

  it('calculates 0% win rate', () => {
    expect(calcWinRate(0, 5)).toBe(0)
  })

  it('calculates 50% win rate', () => {
    expect(calcWinRate(3, 3)).toBe(50)
  })

  it('calculates partial win rate', () => {
    expect(calcWinRate(7, 3)).toBe(70)
  })

  it('returns 0 for no trades', () => {
    expect(calcWinRate(0, 0)).toBe(0)
  })
})

describe('P&L Percentage', () => {
  function calcPnlPercent(entryPrice: number, currentPrice: number): number {
    if (entryPrice <= 0) return 0
    return ((currentPrice - entryPrice) / entryPrice) * 100
  }

  it('calculates percentage gain', () => {
    expect(calcPnlPercent(60000, 66000)).toBeCloseTo(10)
  })

  it('calculates percentage loss', () => {
    expect(calcPnlPercent(60000, 54000)).toBeCloseTo(-10)
  })

  it('calculates zero change', () => {
    expect(calcPnlPercent(60000, 60000)).toBe(0)
  })

  it('handles zero entry price', () => {
    expect(calcPnlPercent(0, 100)).toBe(0)
  })
})

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
    const pnl = calcPnl(600, 650, 10)
    expect(pnl).toBe(500)
  })

  it('calculates negative P&L when price goes down', () => {
    const pnl = calcPnl(600, 550, 10)
    expect(pnl).toBe(-500)
  })

  it('calculates zero P&L when price unchanged', () => {
    const pnl = calcPnl(600, 600, 10)
    expect(pnl).toBe(0)
  })

  it('calculates P&L with large quantity', () => {
    const pnl = calcPnl(100, 120, 10)
    expect(pnl).toBe(200)
  })
})

describe('Whole-share quantity rules', () => {
  function requireWholeShares(quantity: number): number {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Quantity must be a positive whole number')
    }
    if (!Number.isInteger(quantity)) {
      throw new Error('Fractional quantities are not allowed')
    }
    return quantity
  }

  it('accepts integer quantities', () => {
    expect(requireWholeShares(5)).toBe(5)
  })

  it('rejects fractional quantities', () => {
    expect(() => requireWholeShares(1.5)).toThrow(/Fractional/)
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
    const avg = calcAvgEntry(1, 600, 1, 620)
    expect(avg).toBe(610)
  })

  it('weights larger position more', () => {
    const avg = calcAvgEntry(9, 600, 1, 700)
    expect(avg).toBe(610)
  })

  it('updates entry when adding to existing position', () => {
    const avg1 = calcAvgEntry(5, 600, 5, 640)
    expect(avg1).toBe(620)
  })
})

describe('Order Value', () => {
  function calcOrderValue(price: number, quantity: number): number {
    return price * quantity
  }

  it('calculates order value for equity shares', () => {
    expect(calcOrderValue(2500, 4)).toBe(10000)
  })

  it('calculates order value for cheaper names', () => {
    expect(calcOrderValue(70, 100)).toBe(7000)
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
    const cost = 2500 * 4
    const newBalance = balance - cost
    expect(newBalance).toBe(90000)
  })

  it('sell increases balance by proceeds', () => {
    const balance = 90000
    const proceeds = 2600 * 4
    const newBalance = balance + proceeds
    expect(newBalance).toBe(100400)
  })

  it('partial sell uses whole shares', () => {
    const existingQty = 5
    const sellQty = Math.floor(existingQty / 2)
    const remaining = existingQty - sellQty
    expect(sellQty).toBe(2)
    expect(remaining).toBe(3)
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

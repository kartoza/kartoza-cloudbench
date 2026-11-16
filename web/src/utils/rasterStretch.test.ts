import { describe, it, expect } from 'vitest'
import { isNoData, stretchRange } from './rasterStretch'

describe('isNoData', () => {
  it("is the raster's NoData value, NaN or infinity", () => {
    expect(isNoData(-99999, -99999)).toBe(true)
    expect(isNoData(NaN, null)).toBe(true)
    expect(isNoData(Infinity, null)).toBe(true)
    expect(isNoData(0, null)).toBe(false)
    expect(isNoData(0, -99999)).toBe(false)
  })
})

describe('stretchRange', () => {
  it('cuts the 2% tails, so a few huge values do not darken the rest', () => {
    // 100 people per cell almost everywhere, two cities of 20 000.
    const values = [...Array.from({ length: 98 }, (_, i) => 1 + i), 20000, 21000]
    expect(stretchRange(values, null)).toEqual({ min: 3, max: 98 })
  })

  it('ignores NoData, NaN and infinity', () => {
    expect(stretchRange([-99999, NaN, Infinity, 5, 10], -99999)).toEqual({ min: 5, max: 10 })
  })

  it('falls back to the full range when the tails cover everything, and widens a flat one', () => {
    expect(stretchRange([...Array(99).fill(4), 9], null)).toEqual({ min: 4, max: 9 })
    expect(stretchRange([7, 7, 7], null)).toEqual({ min: 7, max: 8 })
  })

  it('is null without a valid pixel', () => {
    expect(stretchRange([NaN, -1], -1)).toBeNull()
  })
})

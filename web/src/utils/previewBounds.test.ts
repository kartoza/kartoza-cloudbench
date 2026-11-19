import { describe, expect, it } from 'vitest'
import { previewBounds } from './previewBounds'

describe('previewBounds', () => {
  it('turns [west, south, east, north] into MapLibre bounds', () => {
    expect(previewBounds([115.1, -8.8, 115.3, -8.6])).toEqual([[115.1, -8.8], [115.3, -8.6]])
  })

  it('keeps a world extent inside Web Mercator', () => {
    expect(previewBounds([-190, -90, 190, 90])).toEqual([[-180, -85.05], [180, 85.05]])
  })

  it('is null when there is nothing to zoom to', () => {
    expect(previewBounds(undefined)).toBeNull()
    expect(previewBounds([])).toBeNull()
    expect(previewBounds([1, 2, 3])).toBeNull()
    expect(previewBounds([3, 0, 1, 1])).toBeNull()
    expect(previewBounds([0, 0, Number.NaN, 1])).toBeNull()
  })
})

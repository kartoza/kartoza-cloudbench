import { describe, it, expect } from 'vitest'
import { defaultMosaicName } from './S3UploadDialog'

const files = (...names: string[]) => names.map((name) => new File([''], name))

describe('defaultMosaicName', () => {
  it("is what the tiles' names have in common", () => {
    expect(defaultMosaicName(files('dem_01.tif', 'dem_02.tif', 'dem_10.tif'))).toBe('dem')
    expect(defaultMosaicName(files('zaf_tile_1.tif', 'zaf_tile_2.TIFF'))).toBe('zaf_tile')
    expect(defaultMosaicName(files('Ortho 2024 - 1.tif', 'Ortho 2024 - 2.tif'))).toBe('Ortho 2024')
  })

  it("falls back to the first tile's name when they share nothing", () => {
    expect(defaultMosaicName(files('north.tif', 'south.tif'))).toBe('north mosaic')
  })
})

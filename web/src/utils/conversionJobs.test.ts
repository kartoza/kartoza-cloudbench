import { describe, it, expect } from 'vitest'
import type { ConversionJob } from '../types'
import { jobKindLabel, layerConversionStatuses } from './conversionJobs'

function job(extra: Partial<ConversionJob>): ConversionJob {
  return {
    id: 'j',
    sourcePath: 'dem',
    outputPath: null,
    sourceFormat: 'tiff',
    targetFormat: 'cog',
    status: 'polling',
    progress: 20,
    message: '',
    error: '',
    startedAt: new Date().toISOString(),
    inputSize: 1,
    ...extra,
  }
}

describe('conversion job helpers', () => {
  it('labels what each kind of job produces', () => {
    expect(jobKindLabel(job({ targetFormat: 'mosaic' }))).toBe('COG mosaic')
    expect(jobKindLabel(job({ targetFormat: 'cog' }))).toBe('COG')
    expect(jobKindLabel(job({ targetFormat: 'copc' }))).toBe('COPC point cloud')
    expect(jobKindLabel(job({ targetFormat: 'pmtiles' }))).toBe('PMTiles + GeoParquet')
  })

  it("shows a mosaic's tiles as done, active and pending as it converts them", () => {
    // Tile 3 of 4 converting: 20% + 60% * 2/4.
    const statuses = layerConversionStatuses(
      job({ targetFormat: 'mosaic', progress: 50, layers: ['a.tif', 'b.tif', 'c.tif', 'd.tif'] })
    )
    expect(statuses?.map((tile) => tile.status)).toEqual(['done', 'done', 'active', 'pending'])
  })
})

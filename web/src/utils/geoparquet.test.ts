import { describe, expect, it } from 'vitest'
import { formatCellValue, geoParquetColumns } from './geoparquet'

// The "geo" metadata GDAL writes for a GeoParquet 1.1 file with a bbox covering.
const GDAL_GEO = JSON.stringify({
  version: '1.1.0',
  primary_column: 'geom',
  columns: {
    geom: {
      encoding: 'WKB',
      covering: {
        bbox: {
          xmin: ['geom_bbox', 'xmin'],
          ymin: ['geom_bbox', 'ymin'],
          xmax: ['geom_bbox', 'xmax'],
          ymax: ['geom_bbox', 'ymax'],
        },
      },
    },
  },
})

describe('geoParquetColumns', () => {
  it('reads the primary geometry column and its bbox covering column', () => {
    expect(geoParquetColumns([{ key: 'geo', value: GDAL_GEO }])).toEqual({
      primary: 'geom',
      geometry: ['geom'],
      covering: ['geom_bbox'],
    })
  })

  it('handles files without GeoParquet metadata, or with invalid metadata', () => {
    const empty = { primary: null, geometry: [], covering: [] }
    expect(geoParquetColumns(undefined)).toEqual(empty)
    expect(geoParquetColumns([{ key: 'ARROW:schema', value: 'x' }])).toEqual(empty)
    expect(geoParquetColumns([{ key: 'geo', value: '{not json' }])).toEqual(empty)
  })
})

describe('formatCellValue', () => {
  it('shows structured values as JSON instead of [object Object]', () => {
    expect(formatCellValue({ xmin: 1, ymax: 2 })).toBe('{"xmin":1,"ymax":2}')
    expect(formatCellValue([1, 2n])).toBe('[1,"2"]')
  })

  it('shows scalars as text and missing values as empty', () => {
    expect(formatCellValue(42)).toBe('42')
    expect(formatCellValue('road')).toBe('road')
    expect(formatCellValue(new Date('2019-12-20T00:00:00Z'))).toBe('2019-12-20T00:00:00.000Z')
    expect(formatCellValue(null)).toBe('')
    expect(formatCellValue(undefined)).toBe('')
  })
})

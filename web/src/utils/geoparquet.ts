// GeoParquet "geo" file metadata helpers (https://geoparquet.org).

import type { KeyValue } from 'hyparquet'

export interface GeoParquetColumns {
  // The primary geometry column, if the file declares one.
  primary: string | null
  // Every geometry column (primary or not).
  geometry: string[]
  // Derived columns that only exist to speed up spatial filtering — e.g. a
  // GeoParquet 1.1 bbox covering struct ("geometry_bbox") — not attributes.
  covering: string[]
}

export function geoParquetColumns(keyValueMetadata: KeyValue[] | undefined): GeoParquetColumns {
  const empty: GeoParquetColumns = { primary: null, geometry: [], covering: [] }
  const raw = keyValueMetadata?.find((kv) => kv.key === 'geo')?.value
  if (!raw) return empty

  let geo: {
    primary_column?: string
    columns?: Record<string, { covering?: Record<string, Record<string, string[]>> }>
  }
  try {
    geo = JSON.parse(raw)
  } catch {
    return empty
  }

  const columns = geo.columns ?? {}
  const covering = new Set<string>()
  for (const column of Object.values(columns)) {
    // covering: { bbox: { xmin: ["geometry_bbox", "xmin"], ... } } — the
    // first path element is the covering column's own name.
    for (const paths of Object.values(column.covering ?? {})) {
      for (const path of Object.values(paths)) {
        if (Array.isArray(path) && typeof path[0] === 'string') covering.add(path[0])
      }
    }
  }
  return {
    primary: geo.primary_column ?? null,
    geometry: Object.keys(columns),
    covering: [...covering],
  }
}

// A table cell's display text: structured values (structs, lists) as JSON
// rather than String()'s "[object Object]".
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
    } catch {
      return String(value)
    }
  }
  return String(value)
}

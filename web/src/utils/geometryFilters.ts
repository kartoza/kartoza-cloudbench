// MapLibre doesn't match a layer to the geometries it suits: a fill layer
// closes each line into a polygon and fills it, and a circle layer draws a
// circle on every vertex of a line or polygon. A layer of lines then shows as
// spiky filled shapes. So each kind of layer only takes its own geometries.
export const POLYGONS_ONLY = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
export const POINTS_ONLY = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

const GEOMETRY_FILTERS: Record<string, unknown[]> = {
  fill: POLYGONS_ONLY,
  'fill-extrusion': POLYGONS_ONLY,
  circle: POINTS_ONLY,
}

/** `layerDef`, kept to its own kind of geometry unless it has a filter already. */
export function withGeometryFilter<T extends Record<string, unknown>>(layerDef: T): T {
  const filter = GEOMETRY_FILTERS[layerDef.type as string]
  return filter && layerDef.filter === undefined ? { ...layerDef, filter } : layerDef
}

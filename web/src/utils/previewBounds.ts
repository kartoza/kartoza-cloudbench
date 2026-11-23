/**
 * A layer's [west, south, east, north] as MapLibre bounds, or null when there
 * are none to zoom to (missing, malformed, or not a box). Latitudes are kept
 * inside Web Mercator, which can't show the poles.
 */
export function previewBounds(bounds?: number[]): [[number, number], [number, number]] | null {
  if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite)) return null
  const [west, south, east, north] = bounds
  if (west > east || south > north) return null
  const clampLat = (lat: number) => Math.max(-85.05, Math.min(85.05, lat))
  return [
    [Math.max(-180, west), clampLat(south)],
    [Math.min(180, east), clampLat(north)],
  ]
}

/**
 * Shared basemap for the MapLibre map previews: Kartoza's own vector tiles
 * (https://world.kartoza.com/viewer.html), "classic" style.
 *
 * One source of truth so every preview looks the same and none reaches for a
 * tile host it shouldn't — `tile.openstreetmap.org` blocks app traffic under
 * its Tile Usage Policy (403). To switch style (e.g. `muted`, `grayscale`) or
 * host, change the constants below.
 */
import type maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'

export const BASEMAP_ORIGIN = 'https://world.kartoza.com'
export const BASEMAP_STYLE_NAME = 'classic'
export const BASEMAP_STYLE_URL = `${BASEMAP_ORIGIN}/styles/${BASEMAP_STYLE_NAME}.json`

/** The style's sources carry no attribution; OSM's licence requires one. */
export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
  '<a href="https://openmaptiles.org/">OpenMapTiles</a>, ' +
  '<a href="https://www.naturalearthdata.com/">Natural Earth</a>, ' +
  '<a href="https://kartoza.com">Kartoza</a>'

/** Prefixes a root-relative URL (`/services/…`) with the basemap host. */
function absolute(url: string): string {
  return url.startsWith('/') && !url.startsWith('//') ? `${BASEMAP_ORIGIN}${url}` : url
}

/**
 * The Kartoza style JSON points at its tiles, glyphs and sprites with
 * root-relative URLs (`/services/planet/tiles/…`, `/fonts/…`, `/sprites/…`),
 * which MapLibre would resolve against CloudBench's own origin. Make them
 * absolute, and add the attribution its sources lack.
 */
export function absolutizeBasemapStyle(style: StyleSpecification): StyleSpecification {
  const sources: StyleSpecification['sources'] = {}
  for (const [id, source] of Object.entries(style.sources ?? {})) {
    const next = { ...source } as Record<string, unknown>
    if (Array.isArray(next.tiles)) next.tiles = (next.tiles as string[]).map(absolute)
    if (typeof next.url === 'string') next.url = absolute(next.url)
    if (typeof next.data === 'string') next.data = absolute(next.data)
    if (!next.attribution) next.attribution = BASEMAP_ATTRIBUTION
    sources[id] = next as unknown as StyleSpecification['sources'][string]
  }

  let sprite = style.sprite
  if (typeof sprite === 'string') sprite = absolute(sprite)
  else if (Array.isArray(sprite)) sprite = sprite.map((s) => ({ ...s, url: absolute(s.url) }))

  return {
    ...style,
    sources,
    sprite,
    glyphs: style.glyphs ? absolute(style.glyphs) : style.glyphs,
  }
}

/**
 * Loads the basemap onto a map created without a `style` option. Its `load`
 * event fires once the basemap is in, as with `style: <url>`.
 */
export function applyBasemap(map: maplibregl.Map): void {
  map.setStyle(BASEMAP_STYLE_URL, {
    transformStyle: (_previous, next) => absolutizeBasemapStyle(next),
  })
}

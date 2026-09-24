/**
 * Shared PMTiles/COG layer loading logic for MapLibre maps.
 *
 * Used by both the full Map Explorer overlay (index.tsx) and the inline
 * single-layer preview shown in the main panel (S3MapPreview.tsx).
 */
import maplibregl from 'maplibre-gl'
import { PMTiles, type Protocol } from 'pmtiles'
import { getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import { getS3PresignedUrl } from '../../api/mapExplorer'
import type { LegendItem } from './types'

export interface LoadedLayerInfo {
  bounds: [number, number, number, number]
  /** Vector PMTiles layers can switch between the default coloring and a saved style; raster/COG can't. */
  isVector: boolean
  sourceLayer?: string
}

export async function addCogLayer(
  mapInstance: maplibregl.Map,
  layerId: string,
  url: string,
  opacity: number
): Promise<[number, number, number, number]> {
  const metadata = await getCogMetadata(url)
  if (!metadata.bbox) throw new Error('COG has no readable bounding box.')

  mapInstance.addSource(layerId, {
    type: 'raster',
    url: `cog://${url}`,
    tileSize: 256,
  })
  mapInstance.addLayer({
    id: layerId,
    type: 'raster',
    source: layerId,
    paint: { 'raster-opacity': opacity / 100 },
  })

  return metadata.bbox
}

export function isRenderedIdFor(renderedId: string, layerId: string): boolean {
  return renderedId === `${layerId}-fill` || renderedId === `${layerId}-line` || renderedId.startsWith(`${layerId}-custom-`)
}

/** Removes any rendered layer(s) previously added for this id (default fill/line, or a custom style's layers). */
export function removeRenderedLayers(mapInstance: maplibregl.Map, layerId: string): void {
  const ids = (mapInstance.getStyle()?.layers ?? [])
    .map((l) => l.id)
    .filter((id) => id === layerId || id.startsWith(`${layerId}-`))
  for (const id of ids) {
    if (mapInstance.getLayer(id)) mapInstance.removeLayer(id)
  }
}

/** Renders a vector PMTiles source either with the default fill/line paint, or a saved custom style's own layers. */
export function applyPmtilesVectorStyle(
  mapInstance: maplibregl.Map,
  layerId: string,
  sourceLayerName: string,
  color: string,
  opacity: number,
  customStyle: Record<string, unknown> | null
): void {
  removeRenderedLayers(mapInstance, layerId)

  const customLayers = Array.isArray(customStyle?.layers) ? (customStyle.layers as Record<string, unknown>[]) : null
  if (customLayers) {
    customLayers
      .filter((layerDef) => layerDef.type !== 'background')
      .forEach((layerDef, i) => {
        mapInstance.addLayer({
          ...layerDef,
          id: `${layerId}-custom-${i}`,
          source: layerId,
          'source-layer': (layerDef['source-layer'] as string | undefined) || sourceLayerName,
        } as maplibregl.LayerSpecification)
      })
    return
  }

  mapInstance.addLayer({
    id: `${layerId}-fill`,
    type: 'fill',
    source: layerId,
    'source-layer': sourceLayerName,
    paint: { 'fill-color': color, 'fill-opacity': opacity / 100 },
  })
  mapInstance.addLayer({
    id: `${layerId}-line`,
    type: 'line',
    source: layerId,
    'source-layer': sourceLayerName,
    paint: { 'line-color': color, 'line-width': 1 },
  })
}

const COLOR_PAINT_PROPS: Record<string, [string, LegendItem['kind']]> = {
  fill: ['fill-color', 'fill'],
  'fill-extrusion': ['fill-extrusion-color', 'fill'],
  line: ['line-color', 'line'],
  circle: ['circle-color', 'circle'],
}

function formatLegendValue(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value)
}

/**
 * Best-effort legend entries for a saved MapLibre style: a plain color gives
 * one entry per style layer, and `match`/`step`/`interpolate` color
 * expressions are expanded into one entry per class/stop.
 */
export function legendItemsFromStyle(style: Record<string, unknown>): LegendItem[] {
  const styleLayers = Array.isArray(style.layers) ? (style.layers as Record<string, unknown>[]) : []
  const items: LegendItem[] = []
  const seen = new Set<string>()
  const push = (label: string, color: unknown, kind: LegendItem['kind']) => {
    if (typeof color !== 'string') return
    const dedupeKey = `${kind}|${label}|${color}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    items.push({ label, color, kind })
  }

  for (const layerDef of styleLayers) {
    const colorProp = COLOR_PAINT_PROPS[layerDef.type as string]
    if (!colorProp) continue
    const [prop, kind] = colorProp
    const value = (layerDef.paint as Record<string, unknown> | undefined)?.[prop]
    const baseLabel = (layerDef.id as string | undefined) ?? String(layerDef.type)

    if (!Array.isArray(value)) {
      push(baseLabel, value, kind)
      continue
    }

    const [op, ...args] = value
    if (op === 'match') {
      // ['match', input, label1, color1, label2, color2, ..., fallback]
      const cases = args.slice(1)
      for (let i = 0; i + 1 < cases.length; i += 2) push(formatLegendValue(cases[i]), cases[i + 1], kind)
      if (cases.length % 2 === 1) push('Other', cases[cases.length - 1], kind)
    } else if (op === 'step') {
      // ['step', input, baseColor, stop1, color1, stop2, color2, ...]
      const stops = args.slice(2)
      push(stops.length > 0 ? `< ${formatLegendValue(stops[0])}` : baseLabel, args[1], kind)
      for (let i = 0; i + 1 < stops.length; i += 2) push(`≥ ${formatLegendValue(stops[i])}`, stops[i + 1], kind)
    } else if (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') {
      // ['interpolate', interpolation, input, stop1, color1, stop2, color2, ...]
      const stops = args.slice(2)
      for (let i = 0; i + 1 < stops.length; i += 2) push(formatLegendValue(stops[i]), stops[i + 1], kind)
    } else if (op === 'case') {
      // ['case', cond1, color1, cond2, color2, ..., fallback] — conditions aren't human-readable.
      for (let i = 0; i + 1 < args.length; i += 2) push(`${baseLabel} ${i / 2 + 1}`, args[i + 1], kind)
      if (args.length % 2 === 1) push('Other', args[args.length - 1], kind)
    }
  }

  return items
}

/** Fetches and renders a single layer's source/layer(s) onto the map. */
export async function loadLayerOntoMap(
  mapInstance: maplibregl.Map,
  protocol: Protocol,
  connectionId: string,
  layer: { id: string; key: string; format: 'pmtiles' | 'cog'; color: string; opacity: number }
): Promise<LoadedLayerInfo> {
  const url = await getS3PresignedUrl(connectionId, layer.key)

  if (layer.format === 'cog') {
    const bounds = await addCogLayer(mapInstance, layer.id, url, layer.opacity)
    return { bounds, isVector: false }
  }

  const pmtiles = new PMTiles(url)
  protocol.add(pmtiles)
  const header = await pmtiles.getHeader()
  const sourceUrl = `pmtiles://${url}`
  const isRaster = header.tileType >= 2
  const bounds: [number, number, number, number] = [header.minLon, header.minLat, header.maxLon, header.maxLat]

  if (isRaster) {
    mapInstance.addSource(layer.id, { type: 'raster', url: sourceUrl, tileSize: 256 })
    mapInstance.addLayer({
      id: layer.id,
      type: 'raster',
      source: layer.id,
      paint: { 'raster-opacity': layer.opacity / 100 },
    })
    return { bounds, isVector: false }
  }

  const metadata = (await pmtiles.getMetadata()) as { vector_layers?: { id: string }[] }
  const sourceLayerName = metadata?.vector_layers?.[0]?.id ?? 'default'
  mapInstance.addSource(layer.id, { type: 'vector', url: sourceUrl })
  applyPmtilesVectorStyle(mapInstance, layer.id, sourceLayerName, layer.color, layer.opacity, null)

  return { bounds, isVector: true, sourceLayer: sourceLayerName }
}

export function layerNameFromKey(key: string, format: 'pmtiles' | 'cog'): string {
  const base = key.split('/').pop() ?? key
  return format === 'cog' ? base.replace(/\.tiff?$/i, '') : base.replace(/\.pmtiles$/i, '')
}

/** Stable, content-derived id so the same object is never added twice and needs no counter. */
export function layerIdFor(option: { connectionId: string; bucketName: string; key: string; format: 'pmtiles' | 'cog' }): string {
  const slug = `${option.connectionId}-${option.bucketName}-${option.key}`.replace(/[^a-zA-Z0-9]/g, '_')
  return `${option.format}-${slug}`
}

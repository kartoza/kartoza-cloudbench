/**
 * Map Explorer API helpers.
 *
 * Talks to the real `/s3/objects/...` and `/s3/presigned/...` routes
 * directly (apps/s3/urls.py) rather than the connections/objects helpers
 * in ./s3, which target endpoints that don't exist on the backend.
 */

import { PMTiles } from 'pmtiles'
import { API_BASE, handleResponse } from './common'
import { getS3Connections } from './s3'

export interface S3PmtilesObject {
  key: string
  size: number
  lastModified: string
}

interface RawS3Object {
  key: string
  size: number
  lastModified: string
  etag: string
  storageClass: string
  isDirectory: boolean
}

interface ListObjectsResult {
  objects: RawS3Object[]
  prefixes: string[]
  isTruncated: boolean
  nextContinuationToken?: string
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

const SOURCE_ARTIFACT_PATTERN = /\/sources\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/i

async function listObjectsByExtensions(
  connectionId: string,
  extensions: string[]
): Promise<S3PmtilesObject[]> {
  const found: S3PmtilesObject[] = []
  let continuationToken: string | undefined

  do {
    const params = new URLSearchParams({ delimiter: '', maxKeys: '1000' })
    if (continuationToken) params.set('continuationToken', continuationToken)

    const response = await fetch(`${API_BASE}/s3/objects/${encodeURIComponent(connectionId)}?${params}`)
    const data = await handleResponse<ListObjectsResult>(response)

    for (const obj of data.objects) {
      const lowerKey = obj.key.toLowerCase()
      if (extensions.some((ext) => lowerKey.endsWith(ext)) && !SOURCE_ARTIFACT_PATTERN.test(obj.key)) {
        found.push({ key: obj.key, size: obj.size, lastModified: obj.lastModified })
      }
    }

    continuationToken = data.isTruncated ? data.nextContinuationToken : undefined
  } while (continuationToken)

  return found
}

export async function listPmtilesObjects(connectionId: string): Promise<S3PmtilesObject[]> {
  return listObjectsByExtensions(connectionId, ['.pmtiles'])
}

export async function listCogObjects(connectionId: string): Promise<S3PmtilesObject[]> {
  const objects = await listObjectsByExtensions(connectionId, ['.tif', '.tiff'])
  // maplibre-cog-protocol only renders Web Mercator COGs. cng-lite's COG
  // conversion always produces one of these ("_3857") alongside the
  // original-CRS file (see apps/s3/cog.py) — only offer that one here.
  return objects.filter((obj) => /_3857\.[^./]+$/i.test(obj.key))
}

export interface S3LayerCatalogEntry {
  connectionId: string
  connectionName: string
  bucketName: string
  key: string
  format: 'pmtiles' | 'cog'
}

export interface S3LayerCatalog {
  /** Whether any S3 connection is configured at all (independent of whether any hold layers). */
  hasConnections: boolean
  entries: S3LayerCatalogEntry[]
}

export interface LayerCollectionSummary {
  id: string
  connectionId: string
  bucket: string
  name: string
  sourceName: string
  itemCount: number
  createdAt: string
}

export interface LayerCollectionItem {
  name: string
  key: string
  format: 'pmtiles' | 'cog'
}

export interface LayerCollectionDetail extends LayerCollectionSummary {
  items: LayerCollectionItem[]
}

// Lists the current user's layer collections — one is created automatically
// per GeoPackage upload, grouping every layer/table it produced.
export async function getLayerCollections(): Promise<LayerCollectionSummary[]> {
  const response = await fetch(`${API_BASE}/s3/collections`)
  return handleResponse(response)
}

export async function getLayerCollection(id: string): Promise<LayerCollectionDetail> {
  const response = await fetch(`${API_BASE}/s3/collections/${encodeURIComponent(id)}`)
  return handleResponse(response)
}

// Walks every configured S3 connection (each scoped to one bucket)
export async function listAllLayerObjects(): Promise<S3LayerCatalog> {
  const connections = await getS3Connections().catch(() => [])
  const entries: S3LayerCatalogEntry[] = []

  for (const connection of connections) {
    try {
      const [pmtilesObjects, cogObjects] = await Promise.all([
        listPmtilesObjects(connection.id),
        listCogObjects(connection.id),
      ])
      for (const obj of pmtilesObjects) {
        entries.push({
          connectionId: connection.id,
          connectionName: connection.name,
          bucketName: connection.bucket,
          key: obj.key,
          format: 'pmtiles',
        })
      }
      for (const obj of cogObjects) {
        entries.push({
          connectionId: connection.id,
          connectionName: connection.name,
          bucketName: connection.bucket,
          key: obj.key,
          format: 'cog',
        })
      }
    } catch {
      // A connection failing to list shouldn't block the rest of the catalog.
    }
  }

  return { hasConnections: connections.length > 0, entries }
}

// A PMTiles style lives as a sibling JSON object next to the tileset itself
export function styleKeyForPmtiles(pmtilesKey: string): string {
  return pmtilesKey.replace(/\.pmtiles$/i, '.style.json')
}

// Fetches a PMTiles layer's saved style, if one exists.
export async function getPmtilesStyle(
  connectionId: string,
  pmtilesKey: string
): Promise<Record<string, unknown> | null> {
  try {
    const url = await getS3PresignedUrl(connectionId, styleKeyForPmtiles(pmtilesKey))
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export async function openStyleEditor(
  connectionId: string,
  pmtilesKey: string,
  layerName: string
): Promise<void> {
  const tilesUrl = await getS3PresignedUrl(connectionId, pmtilesKey)

  let sourceLayer = 'default'
  let center: [number, number] | undefined
  let zoom: number | undefined
  try {
    const pmtiles = new PMTiles(tilesUrl)
    const [metadata, header] = await Promise.all([
      pmtiles.getMetadata() as Promise<{ vector_layers?: { id: string }[] }>,
      pmtiles.getHeader(),
    ])
    sourceLayer = metadata?.vector_layers?.[0]?.id ?? 'default'
    center = [header.centerLon, header.centerLat]
    zoom = header.centerZoom
  } catch {
    // Raster PMTiles or unreadable metadata/header — Maputnik falls back to its own default view.
  }

  const existing = await getPmtilesStyle(connectionId, pmtilesKey)
  const style =
    existing ??
    {
      version: 8,
      name: layerName,
      sources: {
        source: { type: 'vector', url: `pmtiles://${tilesUrl}` },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#f8f9fa' } },
        {
          id: 'fill',
          type: 'fill',
          source: 'source',
          'source-layer': sourceLayer,
          paint: { 'fill-color': '#2d7d9b', 'fill-opacity': 0.5 },
        },
        {
          id: 'line',
          type: 'line',
          source: 'source',
          'source-layer': sourceLayer,
          paint: { 'line-color': '#2d7d9b', 'line-width': 1 },
        },
      ],
    }

  if (center && zoom !== undefined) {
    style.center = center
    style.zoom = zoom
  }

  // A saved style embeds a presigned pmtiles:// URL from whenever it was
  // last saved, which expires — always refresh it to the current one so a
  // previously-saved style doesn't silently fail to load its tileset.
  const sources = style.sources as Record<string, { url?: string }> | undefined
  if (sources) {
    for (const source of Object.values(sources)) {
      if (typeof source?.url === 'string' && source.url.startsWith('pmtiles://')) {
        source.url = `pmtiles://${tilesUrl}`
      }
    }
  }

  const layers = Array.isArray(style.layers) ? (style.layers as Record<string, unknown>[]) : []
  const dataLayerIndex = layers.findIndex((l) => l.type !== 'background')

  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(style))}`
  const params = new URLSearchParams({
    style: dataUrl,
    cbConnectionId: connectionId,
    cbStyleKey: styleKeyForPmtiles(pmtilesKey),
  })
  if (dataLayerIndex >= 0) params.set('layer', `-~${dataLayerIndex}`)

  window.open(`/maputnik/index.html?${params.toString()}`, '_blank')
}

export async function getS3PresignedUrl(
  connectionId: string,
  key: string,
  expirationSeconds = 3600
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/s3/presigned/${encodeURIComponent(connectionId)}/${encodeKey(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiration: expirationSeconds, method: 'get_object' }),
    }
  )
  const data = await handleResponse<{ url: string }>(response)
  return data.url
}

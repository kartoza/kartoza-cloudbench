/**
 * Tests for the Map Explorer API helpers (fetch stubbed, pmtiles mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import {
  getLayerCollection,
  getLayerCollections,
  getPmtilesStyle,
  getS3PresignedUrl,
  listAllLayerObjects,
  listCogObjects,
  listPmtilesObjects,
  openStyleEditor,
  styleKeyForPmtiles,
} from './mapExplorer'

const pmtilesMock = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  getHeader: vi.fn(),
}))

vi.mock('pmtiles', () => ({
  PMTiles: vi.fn(() => pmtilesMock),
}))

const SOURCE_UUID = '12345678-1234-1234-1234-123456789abc'

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function object(key: string) {
  return { key, size: 1, lastModified: '2024', etag: 'e', storageClass: 'S', isDirectory: false }
}

let fetchMock: Mock<[RequestInfo | URL, RequestInit?], Promise<Response>>

function stubFetch(route: Route): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    route(String(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
}

describe('mapExplorer API', () => {
  beforeEach(() => {
    pmtilesMock.getMetadata.mockReset()
    pmtilesMock.getHeader.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listPmtilesObjects follows pagination and skips source artifacts', async () => {
    stubFetch((url) => {
      if (url.includes('continuationToken=t2')) {
        return json({ objects: [object('b/two.PMTILES')], prefixes: [], isTruncated: false })
      }
      return json({
        objects: [
          object('a/one.pmtiles'),
          object(`a/sources/${SOURCE_UUID}/raw.pmtiles`),
          object('a/readme.txt'),
        ],
        prefixes: [],
        isTruncated: true,
        nextContinuationToken: 't2',
      })
    })

    const result = await listPmtilesObjects('conn 1')

    expect(result.map((o) => o.key)).toEqual(['a/one.pmtiles', 'b/two.PMTILES'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/s3/objects/conn%201?')
  })

  it('listCogObjects only keeps Web Mercator COGs', async () => {
    stubFetch(() =>
      json({
        objects: [object('r/dem_3857.tif'), object('r/dem.tif'), object('r/img_3857.TIFF')],
        prefixes: [],
        isTruncated: false,
      }),
    )

    const result = await listCogObjects('c1')

    expect(result.map((o) => o.key)).toEqual(['r/dem_3857.tif', 'r/img_3857.TIFF'])
  })

  it('getLayerCollections and getLayerCollection hit the collections routes', async () => {
    stubFetch((url) => json(url.endsWith('/s3/collections') ? [{ id: 'a' }] : { id: 'a b' }))

    await expect(getLayerCollections()).resolves.toEqual([{ id: 'a' }])
    await expect(getLayerCollection('a b')).resolves.toEqual({ id: 'a b' })
    expect(String(fetchMock.mock.calls[1][0])).toContain('/s3/collections/a%20b')
  })

  it('listAllLayerObjects builds a catalog and tolerates a failing connection', async () => {
    stubFetch((url) => {
      if (url.includes('/s3/connections')) {
        return json([
          { id: 'good', name: 'Good', bucket: 'bkt' },
          { id: 'bad', name: 'Bad', bucket: 'x' },
        ])
      }
      if (url.includes('/s3/objects/bad')) return json({ error: 'down' }, 500)
      return json({
        objects: [object('l/roads.pmtiles'), object('l/dem_3857.tif')],
        prefixes: [],
        isTruncated: false,
      })
    })

    const catalog = await listAllLayerObjects()

    expect(catalog.hasConnections).toBe(true)
    expect(catalog.entries).toEqual([
      {
        connectionId: 'good',
        connectionName: 'Good',
        bucketName: 'bkt',
        key: 'l/roads.pmtiles',
        format: 'pmtiles',
      },
      {
        connectionId: 'good',
        connectionName: 'Good',
        bucketName: 'bkt',
        key: 'l/dem_3857.tif',
        format: 'cog',
      },
    ])
  })

  it('listAllLayerObjects reports no connections when listing them fails', async () => {
    stubFetch(() => json({ error: 'boom' }, 500))

    await expect(listAllLayerObjects()).resolves.toEqual({ hasConnections: false, entries: [] })
  })

  it('styleKeyForPmtiles points at the sibling styles folder', () => {
    expect(styleKeyForPmtiles('a/b/roads.pmtiles')).toBe('a/b/styles/default.json')
    expect(styleKeyForPmtiles('roads.pmtiles')).toBe('styles/default.json')
  })

  it('getS3PresignedUrl posts the expiration and encodes each key segment', async () => {
    stubFetch(() => json({ url: 'https://signed.test/x' }))

    await expect(getS3PresignedUrl('c1', 'a b/c#d.json', 60)).resolves.toBe(
      'https://signed.test/x',
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/s3/presigned/c1/a%20b/c%23d.json')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      expiration: 60,
      method: 'get_object',
    })
  })

  it('getPmtilesStyle returns the saved style, or null when missing or unreachable', async () => {
    stubFetch((url) =>
      url.includes('/s3/presigned/') ? json({ url: 'https://signed.test/style' }) : json({ a: 1 }),
    )
    await expect(getPmtilesStyle('c1', 'l/roads.pmtiles')).resolves.toEqual({ a: 1 })

    stubFetch((url) =>
      url.includes('/s3/presigned/') ? json({ url: 'https://signed.test/style' }) : json({}, 404),
    )
    await expect(getPmtilesStyle('c1', 'l/roads.pmtiles')).resolves.toBeNull()

    stubFetch(() => json({ error: 'nope' }, 500))
    await expect(getPmtilesStyle('c1', 'l/roads.pmtiles')).resolves.toBeNull()
  })

  function openedStyle(open: ReturnType<typeof vi.fn>) {
    const params = new URL(String(open.mock.calls[0][0]), 'http://app.test').searchParams
    const style = JSON.parse(decodeURIComponent(params.get('style')!.split(',')[1]))
    return { params, style }
  }

  it('openStyleEditor builds a default style from the PMTiles metadata', async () => {
    pmtilesMock.getMetadata.mockResolvedValue({ vector_layers: [{ id: 'roads' }] })
    pmtilesMock.getHeader.mockResolvedValue({ centerLon: 10, centerLat: 20, centerZoom: 5 })
    stubFetch((url) => {
      if (url.includes('styles/default.json')) return json({ url: 'https://signed.test/style' })
      if (url.includes('/s3/presigned/')) return json({ url: 'https://signed.test/tiles' })
      return json({}, 404)
    })
    const open = vi.fn()
    vi.stubGlobal('open', open)

    await openStyleEditor('c1', 'l/roads.pmtiles', 'Roads')

    const { params, style } = openedStyle(open)
    expect(String(open.mock.calls[0][0])).toMatch(/^\/maputnik\/index\.html\?/)
    expect(open.mock.calls[0][1]).toBe('_blank')
    expect(params.get('cbConnectionId')).toBe('c1')
    expect(params.get('cbStyleKey')).toBe('l/styles/default.json')
    expect(params.get('layer')).toBe('-~1')
    expect(style.name).toBe('Roads')
    expect(style.center).toEqual([10, 20])
    expect(style.zoom).toBe(5)
    expect(style.layers[1]['source-layer']).toBe('roads')
    expect(style.sources.source.url).toBe('pmtiles://https://signed.test/tiles')
  })

  it('openStyleEditor refreshes the tileset URL of a saved style', async () => {
    pmtilesMock.getMetadata.mockRejectedValue(new Error('raster'))
    pmtilesMock.getHeader.mockRejectedValue(new Error('raster'))
    const saved = {
      version: 8,
      sources: { source: { type: 'vector', url: 'pmtiles://https://expired.test' } },
      layers: [{ id: 'background', type: 'background' }],
    }
    stubFetch((url) => {
      if (url.includes('styles/default.json')) return json({ url: 'https://signed.test/style' })
      if (url.includes('/s3/presigned/')) return json({ url: 'https://signed.test/tiles' })
      return json(saved)
    })
    const open = vi.fn()
    vi.stubGlobal('open', open)

    await openStyleEditor('c1', 'roads.pmtiles', 'Roads')

    const { params, style } = openedStyle(open)
    expect(style.sources.source.url).toBe('pmtiles://https://signed.test/tiles')
    expect(style.center).toBeUndefined()
    // Only a background layer: no data layer to preselect.
    expect(params.get('layer')).toBeNull()
  })
})

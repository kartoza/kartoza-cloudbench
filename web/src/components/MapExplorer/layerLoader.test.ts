import { describe, it, expect, vi, beforeEach } from 'vitest'

import { fromUrl } from 'geotiff'
import { getS3ProxyURL } from '../../api/s3'
import { cogStyleFrom, defaultCogHash, layerNameFromKey, loadLayerOntoMap } from './layerLoader'

vi.mock('geotiff', () => ({ fromUrl: vi.fn() }))

interface FakeImage {
  width: number
  bands?: number
  bits?: number
  format?: number
  mask?: boolean
  noData?: number | null
  data?: number[]
}

/** A geotiff.js GeoTIFF whose images are the given ones (full resolution first). */
function fakeTiff(images: FakeImage[]) {
  const made = images.map((img) => ({
    getWidth: () => img.width,
    getSamplesPerPixel: () => img.bands ?? 1,
    getBitsPerSample: () => img.bits ?? 32,
    getSampleFormat: () => img.format ?? 3,
    getGDALNoData: () => img.noData ?? null,
    fileDirectory: { loadValue: async () => (img.mask ? 4 : 0) },
    readRasters: vi.fn(async () => [Float32Array.from(img.data ?? [])]),
  }))
  vi.mocked(fromUrl).mockResolvedValue({
    getImage: async (i = 0) => made[i],
    getImageCount: async () => made.length,
  } as never)
  return made
}

describe('layerLoader point clouds', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('streams a COPC through the proxy (token in the URL for the worker), with its WGS84 bounds', async () => {
    localStorage.setItem('token', 'sso-tok')
    const lidar = {
      loadPointCloud: vi.fn().mockResolvedValue({
        id: 'pc-1',
        bounds: { minX: -123.07, minY: 44.05, maxX: -123.06, maxY: 44.06, minZ: 0, maxZ: 100 },
      }),
      setOpacity: vi.fn(),
    }
    const map = {} as never
    const protocol = {} as never

    const info = await loadLayerOntoMap(
      map,
      protocol,
      'conn-1',
      { id: 'copc-1', key: 'lidar/autzen.copc.laz', format: 'copc', color: '#000', opacity: 80 },
      () => lidar as never
    )

    // Absolute (the COPC reader does new URL(source) and fetches from a Worker),
    // same-origin, with the token the Worker can't send as a header.
    const expected = new URL(getS3ProxyURL('conn-1', 'lidar/autzen.copc.laz'), window.location.origin)
    expected.searchParams.set('token', 'sso-tok')
    expect(lidar.loadPointCloud).toHaveBeenCalledWith(expected.toString())
    expect(lidar.setOpacity).toHaveBeenCalledWith(0.8)
    expect(info).toEqual({ bounds: [-123.07, 44.05, -123.06, 44.06], isVector: false, pointCloudId: 'pc-1' })
  })

  it('names a COPC layer without its double extension', () => {
    expect(layerNameFromKey('lidar/autzen.copc.laz', 'copc')).toBe('autzen')
  })
})

describe('cogStyleFrom', () => {
  it('takes the colour ramp and raster paint from a saved style', () => {
    const style = {
      sources: { data: { type: 'raster', url: 'cog://../pr.tif#color:BrewerYlGnBu9,0,3000,c' } },
      layers: [{ type: 'raster', paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.3, 'fill-color': 'red' } }],
    }
    expect(cogStyleFrom(style)).toEqual({
      hash: '#color:BrewerYlGnBu9,0,3000,c',
      paint: { 'raster-saturation': -0.3 },
    })
  })

  it('has nothing to apply without a style, or for the plain default', () => {
    expect(cogStyleFrom(null)).toEqual({ hash: '', paint: {} })
    expect(
      cogStyleFrom({
        sources: { data: { type: 'raster', url: 'cog://../a.tif' } },
        layers: [{ type: 'raster' }],
      })
    ).toEqual({ hash: '', paint: {} })
  })
})

describe('defaultCogHash', () => {
  it('gives a one-band Float32 COG (a DEM) a grey min–max ramp, from its smallest overview', async () => {
    const images = fakeTiff([
      { width: 1200, noData: -9999 },
      { width: 300, data: [12, -9999, NaN, Infinity, 845.5, 300] },
      { width: 150, mask: true },
    ])
    expect(await defaultCogHash('/api/s3/proxy/c/dem_3857.tif')).toBe('#color:BrewerGreys9,12,845.5,-c')
    expect(images[1].readRasters).toHaveBeenCalled()
    expect(images[0].readRasters).not.toHaveBeenCalled()
  })

  it('leaves 8-bit and multi-band COGs to the default rendering', async () => {
    fakeTiff([{ width: 100, bits: 8, format: 1 }])
    expect(await defaultCogHash('/x.tif')).toBe('')
    fakeTiff([{ width: 100, bands: 3, bits: 8, format: 1 }])
    expect(await defaultCogHash('/x.tif')).toBe('')
  })

  it('gives up when there is no valid pixel, and widens a flat range', async () => {
    fakeTiff([{ width: 100, data: [NaN, NaN] }])
    expect(await defaultCogHash('/x.tif')).toBe('')
    fakeTiff([{ width: 100, bits: 16, format: 1, data: [7, 7] }])
    expect(await defaultCogHash('/x.tif')).toBe('#color:BrewerGreys9,7,8,-c')
  })
})

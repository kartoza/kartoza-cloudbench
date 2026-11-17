import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getS3ProxyURL } from '../../api/s3'
import { cogStyleFrom, layerNameFromKey, loadLayerOntoMap } from './layerLoader'

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

describe('applyPmtilesVectorStyle', () => {
  it('draws each geometry type with its own layer, so lines are never filled', async () => {
    const { applyPmtilesVectorStyle, isRenderedIdFor } = await import('./layerLoader')
    const added: Record<string, unknown>[] = []
    const map = {
      getStyle: () => ({ layers: [] }),
      getLayer: () => undefined,
      removeLayer: vi.fn(),
      addLayer: (layer: Record<string, unknown>) => added.push(layer),
    } as never

    applyPmtilesVectorStyle(map, 'l1', 'paths', '#f90', 80, null)

    expect(added.map((l) => [l.id, l.type, l.filter])).toEqual([
      ['l1-fill', 'fill', ['==', '$type', 'Polygon']],
      ['l1-line', 'line', ['in', '$type', 'LineString', 'Polygon']],
      ['l1-circle', 'circle', ['==', '$type', 'Point']],
    ])
    expect(added.every((l) => isRenderedIdFor(l.id as string, 'l1'))).toBe(true)
  })
})

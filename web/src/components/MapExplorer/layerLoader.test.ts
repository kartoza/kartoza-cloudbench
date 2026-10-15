import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getS3ProxyURL } from '../../api/s3'
import { layerNameFromKey, loadLayerOntoMap } from './layerLoader'

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

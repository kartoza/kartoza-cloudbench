import { describe, it, expect, vi } from 'vitest'

vi.mock('../../api/mapExplorer', () => ({
  getS3PresignedUrl: vi.fn().mockResolvedValue('https://minio/bucket/autzen.copc.laz?sig'),
}))

import { layerNameFromKey, loadLayerOntoMap } from './layerLoader'

describe('layerLoader point clouds', () => {
  it('streams a COPC through the map\'s LidarControl, with its WGS84 bounds', async () => {
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

    expect(lidar.loadPointCloud).toHaveBeenCalledWith('https://minio/bucket/autzen.copc.laz?sig')
    expect(lidar.setOpacity).toHaveBeenCalledWith(0.8)
    expect(info).toEqual({ bounds: [-123.07, 44.05, -123.06, 44.06], isVector: false, pointCloudId: 'pc-1' })
  })

  it('names a COPC layer without its double extension', () => {
    expect(layerNameFromKey('lidar/autzen.copc.laz', 'copc')).toBe('autzen')
  })
})

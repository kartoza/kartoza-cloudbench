/**
 * Basemap for the Cesium 3D globes: Natural Earth II imagery bundled with
 * Cesium itself (served from our own /cesium/Assets), so it needs no API key
 * and no outside tile host. CARTO's tiles, used before, now only answer
 * "API key required", and the Kartoza basemap (config/basemap.ts) is vector
 * tiles, which Cesium can't drape. It's low resolution (zoom ~5): enough to
 * place a layer on the globe.
 */
import * as Cesium from 'cesium'

export function addGlobeBasemap(viewer: Cesium.Viewer): void {
  viewer.imageryLayers.add(
    Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')),
      {},
    ),
    0,
  )
}

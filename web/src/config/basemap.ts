/**
 * Shared basemap for the map previews.
 *
 * One source of truth so every preview looks the same and none reaches for a
 * tile host it shouldn't. We use OpenFreeMap, which is meant for unlimited app
 * use — unlike `tile.openstreetmap.org`, whose Tile Usage Policy blocks app
 * traffic (it returns 403), which is why the old raster-OSM basemap failed.
 *
 * To move to a controlled/self-hosted basemap (e.g. a MapTiler key or a
 * self-hosted OpenMapTiles), change this one constant.
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

// Shared S3 object key/format helpers used wherever objects are listed
// (currently the connection detail panel).

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function getFileExtension(key: string): string {
  const parts = key.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

export function isCloudNativeFormat(key: string): boolean {
  const ext = getFileExtension(key)
  return ['cog', 'copc', 'parquet', 'geoparquet'].includes(ext) ||
    key.endsWith('.copc.laz') ||
    key.endsWith('.copc.las')
}

// Formats previewable in the integrated map/table preview panel
export function isMapPreviewable(key: string): boolean {
  const ext = getFileExtension(key)
  const keyLower = key.toLowerCase()
  if (['tif', 'tiff', 'cog', 'gtiff', 'geotiff'].includes(ext)) return true
  if (['las', 'laz', 'copc'].includes(ext) || keyLower.endsWith('.copc.laz') || keyLower.endsWith('.copc.las')) return true
  if (['geojson', 'parquet', 'geoparquet', 'json', 'gpkg'].includes(ext)) return true
  return false
}

export function isQueryable(key: string): boolean {
  const ext = getFileExtension(key)
  return ['parquet', 'geoparquet'].includes(ext)
}

// Formats Map Explorer can load directly as a map layer (PMTiles vector/raster tiles, COG rasters)
export function isMapExplorerFormat(key: string): boolean {
  const ext = getFileExtension(key)
  return ['pmtiles', 'tif', 'tiff', 'cog', 'gtiff', 'geotiff'].includes(ext)
}

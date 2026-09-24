/**
 * S3 Storage API
 */

import { API_BASE, handleResponse } from './common'
import type {
  S3Connection,
  S3ConnectionCreate,
  S3ConnectionTestRequest,
  S3ConnectionTestResult,
  S3Object,
  S3UploadResult,
  S3PreviewMetadata,
  S3AttributeTableResponse,
  DuckDBTableInfo,
  DuckDBQueryRequest,
  DuckDBQueryResponse,
} from '../types'

// S3 Connection API — each connection is scoped to exactly one bucket
export async function getS3Connections(): Promise<S3Connection[]> {
  const response = await fetch(`${API_BASE}/s3/connections`)
  return handleResponse<S3Connection[]>(response)
}

export async function getS3Connection(id: string): Promise<S3Connection> {
  const response = await fetch(`${API_BASE}/s3/connections/${id}`)
  const data = await handleResponse<{ connection: S3Connection }>(response)
  return data.connection
}

export async function createS3Connection(conn: S3ConnectionCreate): Promise<Pick<S3Connection, 'id' | 'name' | 'endpoint' | 'bucket'>> {
  const response = await fetch(`${API_BASE}/s3/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse(response)
}

export async function updateS3Connection(id: string, conn: Partial<S3ConnectionCreate>): Promise<void> {
  const response = await fetch(`${API_BASE}/s3/connections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  await handleResponse(response)
}

export async function deleteS3Connection(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/s3/connections/${id}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

export async function testS3Connection(id: string): Promise<S3ConnectionTestResult> {
  const response = await fetch(`${API_BASE}/s3/connections/${id}/test`, {
    method: 'POST',
  })
  return handleResponse<S3ConnectionTestResult>(response)
}

export async function testS3ConnectionDirect(conn: S3ConnectionTestRequest): Promise<S3ConnectionTestResult> {
  const response = await fetch(`${API_BASE}/s3/connections/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<S3ConnectionTestResult>(response)
}

// S3 Object API
interface S3ObjectListResponse {
  objects: Array<{
    key: string
    size: number
    lastModified: string
    etag?: string
    storageClass?: string
    isDirectory?: boolean
  }>
  prefixes: string[]
}

export async function getS3Objects(connectionId: string, prefix = ''): Promise<S3Object[]> {
  const url = prefix
    ? `${API_BASE}/s3/objects/${connectionId}?prefix=${encodeURIComponent(prefix)}`
    : `${API_BASE}/s3/objects/${connectionId}`
  const response = await fetch(url)
  const data = await handleResponse<S3ObjectListResponse>(response)

  const folders: S3Object[] = data.prefixes.map((prefixKey) => ({
    key: prefixKey,
    size: 0,
    lastModified: '',
    isFolder: true,
  }))
  const files: S3Object[] = data.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    lastModified: obj.lastModified,
    etag: obj.etag,
    isFolder: false,
  }))
  return [...folders, ...files]
}

export async function deleteS3Object(connectionId: string, key: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/s3/objects/${connectionId}/${encodeURIComponent(key)}`,
    { method: 'DELETE' }
  )
  return handleResponse<void>(response)
}

// S3 Preview API
export async function getS3PreviewMetadata(connectionId: string, key: string): Promise<S3PreviewMetadata> {
  const response = await fetch(
    `${API_BASE}/s3/preview/${connectionId}/${encodeURIComponent(key)}`
  )
  return handleResponse<S3PreviewMetadata>(response)
}

export async function getS3Attributes(
  connectionId: string,
  key: string,
  limit = 100,
  offset = 0
): Promise<S3AttributeTableResponse> {
  const response = await fetch(
    `${API_BASE}/s3/attributes/${connectionId}?key=${encodeURIComponent(key)}&limit=${limit}&offset=${offset}`
  )
  return handleResponse<S3AttributeTableResponse>(response)
}

// DuckDB Query API for S3 Parquet files
export async function getS3DuckDBTableInfo(connectionId: string, key: string): Promise<DuckDBTableInfo> {
  const response = await fetch(
    `${API_BASE}/s3/duckdb/${connectionId}?key=${encodeURIComponent(key)}`
  )
  return handleResponse<DuckDBTableInfo>(response)
}

export async function executeS3DuckDBQuery(
  connectionId: string,
  key: string,
  query: DuckDBQueryRequest
): Promise<DuckDBQueryResponse> {
  const response = await fetch(
    `${API_BASE}/s3/duckdb/${connectionId}?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }
  )
  return handleResponse<DuckDBQueryResponse>(response)
}

export async function executeS3DuckDBQueryAsGeoJSON(
  connectionId: string,
  key: string,
  query: DuckDBQueryRequest
): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(
    `${API_BASE}/s3/duckdb/geojson/${connectionId}?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }
  )
  return handleResponse<GeoJSON.FeatureCollection>(response)
}

// Upload a file to S3 with progress tracking
export async function uploadToS3(
  connectionId: string,
  file: File,
  key?: string,
  convert?: boolean,
  targetFormat?: string,
  onProgress?: (progress: number) => void,
  subfolder?: boolean,
  prefix?: string,
  companionFiles: File[] = [],
  license?: string
): Promise<S3UploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  companionFiles.forEach((component) => formData.append('companions', component))
  if (key) {
    formData.append('key', key)
  }
  if (convert !== undefined) {
    formData.append('convert', convert.toString())
  }
  if (targetFormat) {
    formData.append('targetFormat', targetFormat)
  }
  if (subfolder !== undefined) {
    formData.append('subfolder', subfolder.toString())
  }
  if (prefix) {
    formData.append('prefix', prefix)
  }
  if (license) {
    formData.append('license', license)
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100)
        onProgress(progress)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'))
    })

    xhr.open('POST', `${API_BASE}/s3/upload/${encodeURIComponent(connectionId)}`)
    const token = localStorage.getItem('token')
    if (token) xhr.setRequestHeader('Authorization', `Token ${token}`)
    xhr.send(formData)
  })
}

export interface GeoPackageLayer {
  name: string
  geometryType: string
  featureCount: number
}

export interface GeoPackageRasterTable {
  name: string
}

// Stage a GeoPackage upload and get back its contents — vector layers
// (name/geometry/feature count) and raster tables (name only) — before
// any conversion starts. A GeoPackage can hold either or both.
export async function inspectGeoPackage(
  connectionId: string,
  file: File,
  key?: string,
  license?: string
): Promise<{ jobId: string; layers: GeoPackageLayer[]; rasterTables: GeoPackageRasterTable[]; key: string }> {
  const formData = new FormData()
  formData.append('file', file)
  if (key) formData.append('key', key)
  if (license) formData.append('license', license)
  const response = await fetch(
    `${API_BASE}/s3/gpkg/inspect/${encodeURIComponent(connectionId)}`,
    { method: 'POST', body: formData }
  )
  return handleResponse(response)
}

// Confirm which layers/tables to convert for a previously-inspected
// GeoPackage job. `format` selects which pipeline handles it — 'pmtiles'
// (vector layers, the default) or 'cog' (raster tables).
export async function convertGeoPackageLayers(
  jobId: string,
  layers: string[],
  format: 'pmtiles' | 'cog' = 'pmtiles'
): Promise<S3UploadResult> {
  const response = await fetch(`${API_BASE}/s3/gpkg/convert/${encodeURIComponent(jobId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layers, format }),
  })
  return handleResponse<S3UploadResult>(response)
}

// Cancel a previously-inspected GeoPackage job, removing its staged S3 upload.
export async function cancelGeoPackageInspection(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/s3/gpkg/convert/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
  await handleResponse<void>(response)
}

// Get a presigned URL for an S3 object
export async function getS3PresignedURL(
  connectionId: string,
  key: string,
  expirationSeconds = 3600
): Promise<{ url: string }> {
  const response = await fetch(
    `${API_BASE}/s3/presigned/${connectionId}/${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiration: expirationSeconds, method: 'get_object' }),
    }
  )
  return handleResponse<{ url: string }>(response)
}

// Backward compatibility aliases
export const getDuckDBTableInfo = getS3DuckDBTableInfo
export const executeDuckDBQuery = executeS3DuckDBQuery
export const executeDuckDBQueryAsGeoJSON = executeS3DuckDBQueryAsGeoJSON

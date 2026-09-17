/**
 * S3 Storage API
 */

import { API_BASE, handleResponse } from './common'
import type {
  S3Connection,
  S3ConnectionCreate,
  S3ConnectionTestResult,
  S3Bucket,
  S3Object,
  S3UploadResult,
  S3PreviewMetadata,
  S3AttributeTableResponse,
  DuckDBTableInfo,
  DuckDBQueryRequest,
  DuckDBQueryResponse,
} from '../types'

// S3 Connection API
export async function getS3Connections(): Promise<S3Connection[]> {
  const response = await fetch(`${API_BASE}/s3/connections`)
  return handleResponse<S3Connection[]>(response)
}

export async function getS3Connection(id: string): Promise<S3Connection> {
  const response = await fetch(`${API_BASE}/s3/connections/${id}`)
  return handleResponse<S3Connection>(response)
}

export async function createS3Connection(conn: S3ConnectionCreate): Promise<S3Connection> {
  const response = await fetch(`${API_BASE}/s3/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<S3Connection>(response)
}

export async function updateS3Connection(id: string, conn: Partial<S3ConnectionCreate>): Promise<S3Connection> {
  const response = await fetch(`${API_BASE}/s3/connections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<S3Connection>(response)
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

export async function testS3ConnectionDirect(conn: S3ConnectionCreate): Promise<S3ConnectionTestResult> {
  const response = await fetch(`${API_BASE}/s3/connections/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<S3ConnectionTestResult>(response)
}

// S3 Bucket API
export async function getS3Buckets(connectionId: string): Promise<S3Bucket[]> {
  const response = await fetch(`${API_BASE}/s3/connections/${connectionId}/buckets`)
  return handleResponse<S3Bucket[]>(response)
}

export async function createS3Bucket(connectionId: string, name: string): Promise<S3Bucket> {
  const response = await fetch(`${API_BASE}/s3/connections/${connectionId}/buckets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return handleResponse<S3Bucket>(response)
}

export async function deleteS3Bucket(connectionId: string, bucketName: string): Promise<void> {
  const response = await fetch(`${API_BASE}/s3/connections/${connectionId}/buckets/${bucketName}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// S3 Object API
export async function getS3Objects(connectionId: string, bucketName: string, prefix = ''): Promise<S3Object[]> {
  const url = prefix
    ? `${API_BASE}/s3/connections/${connectionId}/buckets/${bucketName}/objects?prefix=${encodeURIComponent(prefix)}`
    : `${API_BASE}/s3/connections/${connectionId}/buckets/${bucketName}/objects`
  const response = await fetch(url)
  return handleResponse<S3Object[]>(response)
}

export async function deleteS3Object(connectionId: string, bucketName: string, key: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/s3/connections/${connectionId}/buckets/${bucketName}/objects?key=${encodeURIComponent(key)}`,
    { method: 'DELETE' }
  )
  return handleResponse<void>(response)
}

// S3 Upload with progress
export async function uploadS3Object(
  connectionId: string,
  bucketName: string,
  file: File,
  prefix: string,
  options: { convert?: boolean; subfolder?: boolean } = {},
  onProgress?: (progress: number) => void
): Promise<S3UploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('key', `${prefix}${file.name}`)
  formData.append('prefix', prefix)
  if (options.convert) {
    formData.append('convert', 'true')
  }
  if (options.subfolder) {
    formData.append('subfolder', 'true')
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

    xhr.open('POST', `${API_BASE}/s3/connections/${connectionId}/buckets/${bucketName}/objects`)
    xhr.send(formData)
  })
}

// S3 Preview API
export async function getS3PreviewMetadata(connectionId: string, bucketName: string, key: string): Promise<S3PreviewMetadata> {
  const response = await fetch(
    `${API_BASE}/s3/preview/${connectionId}/${bucketName}?key=${encodeURIComponent(key)}`
  )
  return handleResponse<S3PreviewMetadata>(response)
}

export async function getS3Attributes(
  connectionId: string,
  bucketName: string,
  key: string,
  limit = 100,
  offset = 0
): Promise<S3AttributeTableResponse> {
  const response = await fetch(
    `${API_BASE}/s3/attributes/${connectionId}/${bucketName}?key=${encodeURIComponent(key)}&limit=${limit}&offset=${offset}`
  )
  return handleResponse<S3AttributeTableResponse>(response)
}

// Create folder in S3
export async function createS3Folder(connectionId: string, bucketName: string, prefix: string): Promise<void> {
  const formData = new FormData()
  formData.append('key', prefix.endsWith('/') ? prefix : prefix + '/')
  formData.append('prefix', '')

  const response = await fetch(`${API_BASE}/s3/connections/${connectionId}/buckets/${bucketName}/objects`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse<void>(response)
}

// DuckDB Query API for S3 Parquet files
export async function getS3DuckDBTableInfo(
  connectionId: string,
  bucketName: string,
  key: string
): Promise<DuckDBTableInfo> {
  const response = await fetch(
    `${API_BASE}/s3/duckdb/${connectionId}/${bucketName}?key=${encodeURIComponent(key)}`
  )
  return handleResponse<DuckDBTableInfo>(response)
}

export async function executeS3DuckDBQuery(
  connectionId: string,
  bucketName: string,
  key: string,
  query: DuckDBQueryRequest
): Promise<DuckDBQueryResponse> {
  const response = await fetch(
    `${API_BASE}/s3/duckdb/${connectionId}/${bucketName}?key=${encodeURIComponent(key)}`,
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
  bucketName: string,
  key: string,
  query: DuckDBQueryRequest
): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(
    `${API_BASE}/s3/duckdb/geojson/${connectionId}/${bucketName}?key=${encodeURIComponent(key)}`,
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
  bucketName: string,
  file: File,
  key?: string,
  convert?: boolean,
  targetFormat?: string,
  onProgress?: (progress: number) => void,
  subfolder?: boolean,
  prefix?: string,
  companionFiles: File[] = []
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

    xhr.open('POST', `${API_BASE}/s3/upload/${encodeURIComponent(connectionId)}/${encodeURIComponent(bucketName)}`)
    const token = localStorage.getItem('token')
    if (token) xhr.setRequestHeader('Authorization', `Token ${token}`)
    xhr.send(formData)
  })
}

// Get a presigned URL for an S3 object
export async function getS3PresignedURL(
  connectionId: string,
  bucketName: string,
  key: string,
  expiryMinutes?: number
): Promise<{ url: string; expires: string }> {
  let url = `${API_BASE}/s3/connections/${connectionId}/buckets/${bucketName}/presign?key=${encodeURIComponent(key)}`
  if (expiryMinutes) {
    url += `&expiry=${expiryMinutes}`
  }
  const response = await fetch(url)
  return handleResponse<{ url: string; expires: string }>(response)
}

// Backward compatibility aliases
export const getDuckDBTableInfo = getS3DuckDBTableInfo
export const executeDuckDBQuery = executeS3DuckDBQuery
export const executeDuckDBQueryAsGeoJSON = executeS3DuckDBQueryAsGeoJSON

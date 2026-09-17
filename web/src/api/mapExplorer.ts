/**
 * Map Explorer API helpers.
 *
 * Talks to the real `/s3/objects/...` and `/s3/presigned/...` routes
 * directly (apps/s3/urls.py) rather than the connections/buckets/objects
 * helpers in ./s3, which target endpoints that don't exist on the backend.
 */

import { API_BASE, handleResponse } from './common'

export interface S3PmtilesObject {
  key: string
  size: number
  lastModified: string
}

interface RawS3Object {
  key: string
  size: number
  lastModified: string
  etag: string
  storageClass: string
  isDirectory: boolean
}

interface ListObjectsResult {
  objects: RawS3Object[]
  prefixes: string[]
  isTruncated: boolean
  nextContinuationToken?: string
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

// Walks the whole bucket (delimiter='' -> flat/recursive listing) and
// returns every object whose key ends in .pmtiles.
export async function listPmtilesObjects(
  connectionId: string,
  bucketName: string
): Promise<S3PmtilesObject[]> {
  const found: S3PmtilesObject[] = []
  let continuationToken: string | undefined

  do {
    const params = new URLSearchParams({ delimiter: '', maxKeys: '1000' })
    if (continuationToken) params.set('continuationToken', continuationToken)

    const response = await fetch(
      `${API_BASE}/s3/objects/${encodeURIComponent(connectionId)}/${encodeURIComponent(bucketName)}?${params}`
    )
    const data = await handleResponse<ListObjectsResult>(response)

    for (const obj of data.objects) {
      if (obj.key.toLowerCase().endsWith('.pmtiles')) {
        found.push({ key: obj.key, size: obj.size, lastModified: obj.lastModified })
      }
    }

    continuationToken = data.isTruncated ? data.nextContinuationToken : undefined
  } while (continuationToken)

  return found
}

export async function getS3PresignedUrl(
  connectionId: string,
  bucketName: string,
  key: string,
  expirationSeconds = 3600
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/s3/presigned/${encodeURIComponent(connectionId)}/${encodeURIComponent(bucketName)}/${encodeKey(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiration: expirationSeconds, method: 'get_object' }),
    }
  )
  const data = await handleResponse<{ url: string }>(response)
  return data.url
}

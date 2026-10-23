/**
 * Uploads straight into an S3 bucket (apps/s3/multipart.py).
 *
 * The file goes up in chunks; CloudBench passes each one on to the bucket as
 * a part of an S3 multipart upload as it arrives, storing nothing itself. S3
 * keeps the parts, so a chunk that fails is simply sent again: the retries
 * can go on for minutes, unlike a relay to GeoServer/GeoNode.
 *
 * Covered (see canUploadToS3Directly): plain uploads, a shapefile's parts
 * (zipped in the bucket), conversions to COG/COPC/PMTiles, mosaics (their
 * tiles' headers read in the bucket), and a GeoPackage's inspection
 * (inspectGeoPackageDirectly, read in the bucket).
 */

import type { S3UploadResult } from '../types'
import type { GeoPackageLayer, GeoPackageRasterTable } from './s3'
import { API_BASE, handleResponse } from './common'
import { ChunkError, putChunk } from './relayUpload'

function getCSRFToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  if (match) return match[1]
  return window.__csrfToken || ''
}

// Seconds before each retry of a failed chunk: about 5 minutes in all.
export const S3_RETRY_DELAYS = [1, 2, 4, 8, 15, 30, 30, 30, 30, 30, 30, 30, 30]

// Conversions that go straight to the bucket, and the files they take.
const DIRECT_CONVERSIONS: Record<string, RegExp> = {
  cog: /\.tiff?$/i,
  copc: /\.la[sz]$/i,
  // A vector file, or a shapefile (its ZIP, or its .shp with the parts).
  pmtiles: /\.(geojson|fgb|kml|kmz|zip|shp)$/i,
  // A GeoPackage, read in the bucket before converting (inspectGeoPackageDirectly).
  inspect: /\.gpkg$/i,
}

/** Whether an upload goes straight to the bucket (else through uploadToS3). */
export function canUploadToS3Directly(
  file: File,
  companionFiles: File[],
  targetFormat?: string,
): boolean {
  // Several files are a mosaic's GeoTIFFs, or a shapefile's parts with the .shp first.
  if (targetFormat === 'mosaic') {
    return companionFiles.length > 0 && [file, ...companionFiles].every((f) => /\.tiff?$/i.test(f.name))
  }
  if (companionFiles.length > 0 && !/\.shp$/i.test(file.name)) return false
  if (!targetFormat) return true
  return DIRECT_CONVERSIONS[targetFormat]?.test(file.name) ?? false
}

export interface S3DirectFields {
  key?: string
  targetFormat?: string
  license?: string
  licenseUrl?: string
  replace?: boolean
  serverTypeId?: number
  autoDestroy?: boolean
  instanceServerId?: string
}

export interface S3DirectHandlers {
  onProgress?: (pct: number) => void
  /** A chunk failed and will be sent again in `delaySeconds`. */
  onRetry?: (attempt: number, delaySeconds: number) => void
  /** Called once a chunk goes through again. */
  onRecovered?: () => void
  isCancelled?: () => boolean
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function body(fields: S3DirectFields): Record<string, unknown> {
  return {
    key: fields.key,
    convert: fields.targetFormat ? 'true' : 'false',
    targetFormat: fields.targetFormat,
    license: fields.license,
    licenseUrl: fields.licenseUrl,
    replace: fields.replace ? 'true' : 'false',
    serverTypeId: fields.serverTypeId,
    autoDestroy: fields.autoDestroy === undefined ? undefined : String(fields.autoDestroy),
    instanceServerId: fields.instanceServerId,
  }
}

async function post<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  return handleResponse<T>(res)
}

export async function cancelS3Upload(connectionId: string, sessionId: string): Promise<void> {
  await fetch(
    `${API_BASE}/s3/multipart/${encodeURIComponent(connectionId)}/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE', headers: { 'X-CSRFToken': getCSRFToken() }, credentials: 'include' },
  ).catch(() => undefined)
}

interface Started {
  sessionId: string
  filename: string
  chunkSize: number
  totalChunks: number
}

/**
 * Start, send every chunk of `file` and its `companions`, then complete:
 * what completing answers; null if cancelled; throws why it failed.
 */
async function sendStraight<T>(
  connectionId: string,
  file: File,
  companions: File[],
  fields: S3DirectFields,
  handlers: S3DirectHandlers,
): Promise<T | null> {
  const sleep = handlers.sleep ?? wait
  const base = `${API_BASE}/s3/multipart/${encodeURIComponent(connectionId)}`
  const started = await post<Started & { companions: Started[] }>(base, {
    ...body(fields),
    filename: file.name,
    fileSize: file.size,
    companions: companions.map((c) => ({ filename: c.name, fileSize: c.size })),
  })
  const { sessionId } = started
  const byName = new Map(companions.map((f) => [f.name, f]))
  const uploads = [started, ...(started.companions ?? [])]
  const totalBytes = [file, ...companions].reduce((sum, f) => sum + f.size, 0)
  let sentBytes = 0

  for (const [n, upload] of uploads.entries()) {
    const source = n === 0 ? file : (byName.get(upload.filename) as File)
    const session = `${base}/${encodeURIComponent(upload.sessionId)}`
    for (let index = 0; index < upload.totalChunks; index++) {
      const chunk = source.slice(
        index * upload.chunkSize,
        Math.min((index + 1) * upload.chunkSize, source.size),
      )
      for (let attempt = 0; ; attempt++) {
        if (handlers.isCancelled?.()) {
          await cancelS3Upload(connectionId, sessionId)
          return null
        }
        try {
          await putChunk(`${session}/parts/${index}`, chunk, (pct) =>
            handlers.onProgress?.(
              totalBytes ? Math.round(((sentBytes + (chunk.size * pct) / 100) / totalBytes) * 100) : 100,
            ),
          )
          if (attempt > 0) handlers.onRecovered?.()
          break
        } catch (err) {
          const error = err as ChunkError
          if (!error.retryable || attempt >= S3_RETRY_DELAYS.length) {
            await cancelS3Upload(connectionId, sessionId)
            throw new Error(error.message)
          }
          handlers.onRetry?.(attempt + 1, S3_RETRY_DELAYS[attempt])
          await sleep(S3_RETRY_DELAYS[attempt] * 1000)
        }
      }
      sentBytes += chunk.size
    }
  }
  if (handlers.isCancelled?.()) {
    await cancelS3Upload(connectionId, sessionId)
    return null
  }
  return post<T>(`${base}/${encodeURIComponent(sessionId)}/complete`, body(fields))
}

/**
 * Upload `file` (and a .shp's `companionFiles`) straight into the bucket.
 * Answers as uploadToS3 does; null if cancelled; throws why it failed.
 */
export async function uploadToS3Directly(
  connectionId: string,
  file: File,
  fields: S3DirectFields,
  handlers: S3DirectHandlers = {},
  companionFiles: File[] = [],
): Promise<S3UploadResult | null> {
  return sendStraight<S3UploadResult>(connectionId, file, companionFiles, fields, handlers)
}

export interface GeoPackageInspection {
  jobId: string
  layers: GeoPackageLayer[]
  rasterTables: GeoPackageRasterTable[]
  key: string
}

/**
 * Upload a GeoPackage straight to its conversion's source key, and read
 * what it holds there (as inspectGeoPackage answers): its job waits for the
 * layers to be picked (convertGeoPackage). null if cancelled.
 */
export async function inspectGeoPackageDirectly(
  connectionId: string,
  file: File,
  fields: Omit<S3DirectFields, 'targetFormat'>,
  handlers: S3DirectHandlers = {},
): Promise<GeoPackageInspection | null> {
  return sendStraight<GeoPackageInspection>(
    connectionId,
    file,
    [],
    { ...fields, targetFormat: 'inspect' },
    handlers,
  )
}

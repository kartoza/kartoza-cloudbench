/**
 * Bulk upload API:
 * convert every layer in a bucket folder, a few at a time.
 */

import { API_BASE, handleResponse } from './common'

// The conversion a file gets: PMTiles + GeoParquet, COG, or COPC.
export type BulkKind = 'pmtiles' | 'cog' | 'copc'

export interface BulkFile {
  key: string
  name: string
  size: number
  // Null for a file bulk upload leaves alone (see skipReason).
  kind: BulkKind | null
  // The layer folder it would publish into, and whether that holds data already.
  target: string | null
  exists: boolean
  skipReason?: string | null
}

export interface BulkPreview {
  prefix: string
  files: BulkFile[]
  // More files in the folder than were read.
  truncated: boolean
  limits: {
    // The most conversions that may run at once (N).
    maxConcurrency: number
    // On-demand servers aren't supported by bulk upload yet.
    onDemand: boolean
  }
}

// skip: leave an existing layer alone. replace: convert over it. stop: an
// existing layer is a failure, and the first failure cancels the rest.
export type OnExists = 'skip' | 'replace' | 'stop'

export type BulkDestination = 'root' | 'beside' | 'folder'

export interface BulkOptions {
  prefix: string
  // The keys of the files to convert, from the preview.
  files: string[]
  license: string
  licenseUrl: string
  // Where the layers go (a folder per layer): the bucket's top level, where other
  // uploads' layers are; beside each file; or into `destinationPrefix`.
  destination: BulkDestination
  destinationPrefix: string
  onExists: OnExists
  concurrency: number
  // The connection whose bucket the folder is in; the same as the one the layers go to
  // (the default) when it is in their own.
  sourceConnectionId?: string
  // Also publish a VRT collection `vrtName` of the converted GeoTIFFs (two or more).
  createVrt?: boolean
  vrtName?: string
  // On demand: the server type (GeoHosting's id) the servers are started as - `concurrency` of
  // them at most - and whether they are deleted once the batch doesn't need them.
  serverTypeId?: number
  autoDestroy?: boolean
}

export type BulkJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export interface BulkJob {
  key: string
  name: string
  kind: BulkKind
  status: BulkJobStatus
  progress: number
  message: string
  error?: string | null
}

// The VRT collection a bulk upload also publishes of its GeoTIFFs, once they are converted.
// It never fails the batch: `failed` and `skipped` say why there is none.
export interface BulkVrt {
  state: 'pending' | 'building' | 'done' | 'skipped' | 'failed'
  message?: string
  // Where it was published (state `done`): its collection folder, the VRT file's key.
  folder?: string
  key?: string
  count?: number
  // Rasters left out for not being alike (CRS, bands, data type, nodata).
  leftOut?: { name: string; reason: string }[]
}

// On demand: how many of the batch's servers are in each state.
export interface BulkServers {
  starting: number
  ready: number
  stopping: number
  failed: number
}

export type BulkBatchStatus = 'running' | 'cancelling' | 'completed' | 'partial' | 'failed' | 'cancelled'

export interface BulkBatch {
  id: string
  // Where the layers go.
  connectionId: string | null
  // Where the folder is read from, when that is another connection's bucket (else null).
  sourceConnectionId?: string | null
  sourceName?: string | null
  prefix: string
  status: BulkBatchStatus
  concurrency: number
  onExists: OnExists
  // Null when no VRT was asked for.
  vrt?: BulkVrt | null
  // Null without on-demand servers.
  servers?: BulkServers | null
  createdAt: string
  completedAt: string | null
  jobs: BulkJob[]
}

export interface BulkFolder {
  prefix: string
  name: string
}

export function isActiveBatch(batch: BulkBatch): boolean {
  return batch.status === 'running' || batch.status === 'cancelling'
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// The subfolders of `prefix` ("" is the bucket's top level) that may hold source
// files: not published layers, layer groups or staged sources, which are
// CloudBench's own.
export async function listBulkFolders(connectionId: string, prefix: string): Promise<BulkFolder[]> {
  const params = new URLSearchParams()
  if (prefix) params.set('prefix', prefix)
  const response = await fetch(`${API_BASE}/s3/bulk/folders/${encodeURIComponent(connectionId)}?${params}`)
  const data = await handleResponse<{ folders: BulkFolder[] }>(response)
  return data.folders
}

// What bulk upload would do with a folder; reads the buckets only. The layers would go
// into `connectionId`'s bucket; the folder is in `sourceConnectionId`'s (default: the
// same). Where in it (`destination`, and `destinationPrefix` for a folder) decides which
// of them already exist.
export async function previewBulk(
  connectionId: string,
  prefix: string,
  destination: BulkDestination = 'beside',
  destinationPrefix = '',
  sourceConnectionId?: string
): Promise<BulkPreview> {
  const response = await fetch(`${API_BASE}/s3/bulk/preview/${encodeURIComponent(connectionId)}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ prefix, destination, destinationPrefix, sourceConnectionId }),
  })
  return handleResponse(response)
}

export async function startBulk(connectionId: string, options: BulkOptions): Promise<BulkBatch> {
  const response = await fetch(`${API_BASE}/s3/bulk/start/${encodeURIComponent(connectionId)}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(options),
  })
  return handleResponse(response)
}

export async function getBulk(batchId: string): Promise<BulkBatch> {
  const response = await fetch(`${API_BASE}/s3/bulk/${encodeURIComponent(batchId)}`)
  return handleResponse(response)
}

// The running bulk uploads, and those finished in the last 24 h.
export async function listBulk(): Promise<BulkBatch[]> {
  const response = await fetch(`${API_BASE}/s3/bulk`)
  return handleResponse(response)
}

export async function cancelBulk(batchId: string): Promise<BulkBatch> {
  const response = await fetch(`${API_BASE}/s3/bulk/${encodeURIComponent(batchId)}`, { method: 'DELETE' })
  return handleResponse(response)
}

// Convert the layers that failed again.
export async function retryBulk(batchId: string): Promise<BulkBatch> {
  const response = await fetch(`${API_BASE}/s3/bulk/${encodeURIComponent(batchId)}/retry`, { method: 'POST' })
  return handleResponse(response)
}

// The Jobs panel's and the dialog's shared list of batches.
export const BULK_BATCHES_QUERY_KEY = ['bulkBatches']

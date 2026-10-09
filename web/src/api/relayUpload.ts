/**
 * Uploads relayed straight to GeoServer/GeoNode (apps/upload/relay.py).
 *
 * The file goes up in chunks, and CloudBench passes each one on to the target
 * as it arrives, never storing it. A chunk whose request fails on the way
 * (dropped connection, gateway error) is sent again with backoff; the relay
 * acknowledges one it already has. The target can't wait long for the next
 * chunk (about a minute), so the retries stop well before that.
 */

import { API_BASE, handleResponse, setAuthHeader } from './common'

function getCSRFToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  if (match) return match[1]
  return window.__csrfToken || ''
}

export const RELAY_CHUNK_SIZE = 5 * 1024 * 1024
// Seconds to wait before each retry of a failed chunk: ~30s in all, inside
// the relay's 60s idle timeout.
export const RETRY_DELAYS = [1, 2, 4, 8, 16]
const POLL_INTERVAL_MS = 1000

export type RelayTarget =
  | { target: 'geoserver'; connectionId: string; workspace: string; storeName: string }
  | {
      target: 'geonode'
      connectionId: string
      uploadType: 'dataset' | 'document'
      title?: string
      abstract?: string
    }

export interface RelayStarted {
  sessionId: string
  chunkSize: number
  totalChunks: number
  storeName: string
}

export type RelayState = 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface RelayStatus {
  state: RelayState
  error: string
  result: Record<string, unknown> | null
}

export async function startRelayUpload(file: File, target: RelayTarget): Promise<RelayStarted> {
  const res = await fetch(`${API_BASE}/upload/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
    credentials: 'include',
    body: JSON.stringify({
      ...target,
      filename: file.name,
      fileSize: file.size,
      chunkSize: RELAY_CHUNK_SIZE,
    }),
  })
  return handleResponse<RelayStarted>(res)
}

/** A chunk the relay refused; `retryable` when sending it again may work. */
export class ChunkError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

// No answer, or a gateway between us and CloudBench gave up: worth retrying.
const RETRYABLE_STATUSES = [0, 502, 503, 504]

export function sendRelayChunk(
  sessionId: string,
  index: number,
  chunk: Blob,
  onProgress?: (pct: number) => void,
): Promise<{ next: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(
      'PUT',
      `${API_BASE}/upload/relay/${encodeURIComponent(sessionId)}/chunks/${index}`,
    )
    setAuthHeader(xhr)
    xhr.setRequestHeader('X-CSRFToken', getCSRFToken())
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let body: { next?: number; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* a gateway's HTML error page */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ next: body.next ?? index + 1 })
      } else {
        reject(
          new ChunkError(
            body.error || `HTTP ${xhr.status}`,
            RETRYABLE_STATUSES.includes(xhr.status),
          ),
        )
      }
    }
    xhr.onerror = () => reject(new ChunkError('Network error during upload', true))
    xhr.ontimeout = () => reject(new ChunkError('Upload timed out', true))
    xhr.send(chunk)
  })
}

export interface ChunkLoopHandlers {
  onChunkProgress?: (pct: number) => void
  onChunkSent?: (sentChunks: number, sentBytes: number) => void
  /** A chunk failed and will be sent again in `delaySeconds`. */
  onRetry?: (attempt: number, delaySeconds: number, error: string) => void
  isCancelled?: () => boolean
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Send every chunk in order, retrying a failed one. Returns false if cancelled. */
export async function sendRelayChunks(
  file: File,
  started: RelayStarted,
  handlers: ChunkLoopHandlers = {},
): Promise<boolean> {
  const { chunkSize, totalChunks, sessionId } = started
  const sleep = handlers.sleep ?? wait
  let index = 0
  while (index < totalChunks) {
    if (handlers.isCancelled?.()) return false
    const start = index * chunkSize
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size))
    for (let attempt = 0; ; attempt++) {
      try {
        const { next } = await sendRelayChunk(sessionId, index, chunk, handlers.onChunkProgress)
        index = next
        break
      } catch (err) {
        const error = err as ChunkError
        if (!error.retryable || attempt >= RETRY_DELAYS.length || handlers.isCancelled?.()) {
          throw new Error(
            error.retryable
              ? `${error.message}. The connection didn't come back in time; start the upload again.`
              : error.message,
          )
        }
        const delay = RETRY_DELAYS[attempt]
        handlers.onRetry?.(attempt + 1, delay, error.message)
        await sleep(delay * 1000)
      }
    }
    handlers.onChunkSent?.(index, Math.min(index * chunkSize, file.size))
  }
  return true
}

export async function getRelayStatus(sessionId: string): Promise<RelayStatus> {
  const res = await fetch(`${API_BASE}/upload/relay/${encodeURIComponent(sessionId)}`, {
    credentials: 'include',
  })
  return handleResponse<RelayStatus>(res)
}

/** Wait for the target's answer once every chunk is sent. */
export async function waitForRelay(
  sessionId: string,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<RelayStatus> {
  for (;;) {
    let status: RelayStatus | null = null
    try {
      status = await getRelayStatus(sessionId)
    } catch {
      /* a blip while polling: ask again */
    }
    if (status && !['uploading', 'processing'].includes(status.state)) return status
    await sleep(POLL_INTERVAL_MS)
  }
}

export async function cancelRelayUpload(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/upload/relay/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { 'X-CSRFToken': getCSRFToken() },
    credentials: 'include',
  }).catch(() => undefined)
}

/** Start, send and finish an upload: the target's answer, or throws why it failed. */
export async function relayUpload(
  file: File,
  target: RelayTarget,
  handlers: ChunkLoopHandlers & { onStarted?: (started: RelayStarted) => void } = {},
): Promise<RelayStatus | null> {
  const started = await startRelayUpload(file, target)
  handlers.onStarted?.(started)
  const sent = await sendRelayChunks(file, started, handlers)
  if (!sent) return null
  const status = await waitForRelay(started.sessionId, handlers.sleep)
  if (status.state === 'failed') throw new Error(status.error || 'Upload failed')
  return status
}

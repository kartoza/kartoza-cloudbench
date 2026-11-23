import { API_BASE, setAuthHeader } from './common'
import { RETRY_DELAYS } from './relayUpload'

declare global {
  interface Window {
    __csrfToken?: string
  }
}

// Helper to get CSRF token for XHR requests
function getCSRFToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  if (match) return match[1]
  return window.__csrfToken || ''
}

export const CHUNK_SIZE = 5 * 1024 * 1024

export async function initUploadSession(
  connId: string,
  workspace: string,
  filename: string,
  fileSize: number,
  chunkSize = CHUNK_SIZE,
): Promise<{ sessionId: string; chunkSize: number; totalChunks: number }> {
  const res = await fetch(`${API_BASE}/upload/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ connectionId: connId, workspace, filename, fileSize, chunkSize }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function uploadChunk(
  sessionId: string,
  chunkIndex: number,
  chunk: Blob,
  onProgress?: (pct: number) => void,
): Promise<{ received: number; totalChunks: number }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('sessionId', sessionId)
    formData.append('chunkIndex', String(chunkIndex))
    formData.append('chunk', chunk)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/upload/chunk`)
    setAuthHeader(xhr)
    xhr.setRequestHeader('X-CSRFToken', getCSRFToken())
    xhr.withCredentials = true

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Invalid JSON response'))
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.error || `HTTP ${xhr.status}`))
        } catch {
          reject(new Error(`HTTP ${xhr.status}`))
        }
      }
    }

    xhr.onerror = () => reject(new Error('Network error during chunk upload'))
    xhr.onabort = () => reject(new Error('Upload aborted'))

    xhr.send(formData)
  })
}

export interface StageHandlers {
  onStarted?: (sessionId: string, totalChunks: number) => void
  onChunkProgress?: (pct: number) => void
  onChunkSent?: (sentChunks: number, sentBytes: number) => void
  onRetry?: (attempt: number, delaySeconds: number) => void
  isCancelled?: () => boolean
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Stage a whole file on CloudBench, chunk by chunk; returns its session id,
 * or null if cancelled. A failed chunk is sent again with backoff.
 */
export async function stageFile(file: File, handlers: StageHandlers = {}): Promise<string | null> {
  const sleep = handlers.sleep ?? wait
  const { sessionId, totalChunks } = await initUploadSession('', '', file.name, file.size, CHUNK_SIZE)
  handlers.onStarted?.(sessionId, totalChunks)
  for (let index = 0; index < totalChunks; index++) {
    if (handlers.isCancelled?.()) {
      await cancelUpload(sessionId)
      return null
    }
    const chunk = file.slice(index * CHUNK_SIZE, Math.min((index + 1) * CHUNK_SIZE, file.size))
    for (let attempt = 0; ; attempt++) {
      try {
        await uploadChunk(sessionId, index, chunk, handlers.onChunkProgress)
        break
      } catch (err) {
        if (attempt >= RETRY_DELAYS.length || handlers.isCancelled?.()) throw err
        handlers.onRetry?.(attempt + 1, RETRY_DELAYS[attempt])
        await sleep(RETRY_DELAYS[attempt] * 1000)
      }
    }
    handlers.onChunkSent?.(index + 1, Math.min((index + 1) * CHUNK_SIZE, file.size))
  }
  return sessionId
}

// A GeoPackage dataset for GeoNode is staged on CloudBench (stageFile)
// rather than relayed: its layers are read, and split one per dataset,
// from the whole file.
export async function detectGeoNodeLayers(
  sessionId: string,
): Promise<{ filename: string; layers: string[] }> {
  const res = await fetch(`${API_BASE}/geonode/upload/detect-layers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function completeGeoNodeUpload(
  sessionId: string,
  connectionId: string,
  title?: string,
  abstract?: string,
  sourceLayers?: string[],
): Promise<{ published: boolean; filename: string; fileSize: number; [key: string]: unknown }> {
  const res = await fetch(`${API_BASE}/geonode/upload/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ sessionId, connectionId, title, abstract, sourceLayers }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function completePGUpload(
  sessionId: string,
): Promise<{ path: string; filename: string; fileSize: number; sessionId: string }> {
  const res = await fetch(`${API_BASE}/pg/upload/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function cancelUpload(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/upload/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: {
      'X-CSRFToken': getCSRFToken(),
    },
    credentials: 'include',
  })
}

import { API_BASE } from './common'
import type { UploadResult } from '../types'

// Helper to get CSRF token for XHR requests
function getCSRFToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  if (match) return match[1]
  return (window as any).__csrfToken || ''
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

export async function completeUpload(sessionId: string): Promise<UploadResult> {
  const res = await fetch(`${API_BASE}/upload/complete`, {
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
  uploadType: 'dataset' | 'document' = 'dataset',
): Promise<{ published: boolean; filename: string; fileSize: number; [key: string]: unknown }> {
  const res = await fetch(`${API_BASE}/geonode/upload/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ sessionId, connectionId, title, abstract, uploadType }),
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

export async function completeGeoServerUpload(
  sessionId: string,
  connId: string,
  workspace: string,
  storeName?: string,
): Promise<{ path: string; filename: string; fileSize: number; sessionId: string; storeName: string }> {
  const res = await fetch(`${API_BASE}/upload/complete/${encodeURIComponent(connId)}/${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCSRFToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ sessionId, storeName }),
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

export interface GeoServerProgress {
  sent: number
  total: number
  done: boolean
}

export async function getGeoServerProgress(sessionId: string): Promise<GeoServerProgress> {
  const res = await fetch(`${API_BASE}/upload/session/${encodeURIComponent(sessionId)}/progress`)
  if (!res.ok) return { sent: 0, total: 0, done: true }
  return res.json()
}

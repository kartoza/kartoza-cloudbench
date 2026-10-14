/**
 * Common API utilities and base configuration
 */

import { getApiBase } from '../config/env'

export const API_BASE = getApiBase()

// Patch fetch to inject auth token from localStorage on every request
const _originalFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const token = localStorage.getItem('token')
  if (token) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.startsWith(API_BASE) || url.startsWith('/api')) {
      // Build via Headers so a caller's existing headers are kept whatever
      // form they take — a plain object, an array, or a Headers instance.
      // Spreading `...init.headers` dropped a Headers instance entirely
      // (it has no enumerable own properties), which stripped the Range
      // header pmtiles sends as a Headers object: the proxy then answered
      // 200 (whole file) instead of 206, and pmtiles rejected it with
      // "content-length exceeding request". geotiff passes a plain object,
      // so its ranges survived and COGs loaded — this only bit pmtiles.
      const headers = new Headers(init?.headers ?? {})
      if (!headers.has('Authorization')) headers.set('Authorization', `Token ${token}`)
      init = { ...init, headers }
    }
  }
  return _originalFetch(input, init)
}

// XMLHttpRequest (used where upload progress is needed) bypasses the fetch
// patch above, so it must add the token itself - without it, inside the
// GeoHosting iframe (where the session cookie isn't sent) the request is 401.
export function setAuthHeader(xhr: XMLHttpRequest): void {
  const token = localStorage.getItem('token')
  if (token) xhr.setRequestHeader('Authorization', `Token ${token}`)
}

export async function handleResponse<T>(response: Response): Promise<T> {
  // Only a stale token is worth reloading for: dropping it lands on the login
  // screen. With no token there is nothing to drop, and reloading would just
  // re-send the same unauthenticated request forever.
  if ([401, 403].includes(response.status) && localStorage.getItem('token')) {
    localStorage.removeItem('token')
    window.location.reload()
    // Reload is already underway — never resolve, so callers don't race
    // it with their own error handling.
    return new Promise<T>(() => {})
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || error.detail || `HTTP ${response.status}`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json()
}

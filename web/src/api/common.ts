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
      init = { ...init, headers: { Authorization: `Token ${token}`, ...(init?.headers ?? {}) } }
    }
  }
  return _originalFetch(input, init)
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

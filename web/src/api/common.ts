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
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || error.detail || `HTTP ${response.status}`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json()
}

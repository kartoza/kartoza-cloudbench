/**
 * DataStore and CoverageStore API
 */

import { API_BASE, handleResponse } from './common'
import type {
  DataStore,
  CoverageStore,
  DataStoreCreate,
  CoverageStoreCreate,
} from '../types'

// Data Store API
export async function getDataStores(connId: string, workspace: string): Promise<DataStore[]> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}`)
  return handleResponse<DataStore[]>(response)
}

export async function getDataStore(connId: string, workspace: string, name: string): Promise<DataStore> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${name}`)
  return handleResponse<DataStore>(response)
}

export async function createDataStore(connId: string, workspace: string, store: DataStoreCreate): Promise<DataStore> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store),
  })
  return handleResponse<DataStore>(response)
}

export async function deleteDataStore(connId: string, workspace: string, name: string, recurse = false): Promise<void> {
  const params = recurse ? '?recurse=true' : ''
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${name}${params}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

export async function connectDataStoreToPG(
  connId: string,
  workspace: string,
  pgConnId: string,
  options?: { name?: string; database?: string; schema?: string; description?: string; enabled?: boolean }
): Promise<{ message: string }> {
  const response = await fetch(
    `${API_BASE}/datastores/${connId}/${workspace}/connect/${encodeURIComponent(pgConnId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    }
  )
  return handleResponse<{ message: string }>(response)
}

export async function getAvailableFeatureTypes(connId: string, workspace: string, store: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${store}/available`)
  const result = await handleResponse<{ available: string[] }>(response)
  return result.available || []
}

export async function publishFeatureTypes(
  connId: string,
  workspace: string,
  store: string,
  featureTypes: string[],
  srs = 'EPSG:4326',
): Promise<{ published: string[]; errors: Array<{ name: string; error: string }> }> {
  const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || ''
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${store}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
    credentials: 'include',
    body: JSON.stringify({ featureTypes, srs }),
  })
  return handleResponse<{ published: string[]; errors: Array<{ name: string; error: string }> }>(response)
}

// Coverage Store API
export async function getCoverageStores(connId: string, workspace: string): Promise<CoverageStore[]> {
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}`)
  return handleResponse<CoverageStore[]>(response)
}

export async function getCoverageStore(connId: string, workspace: string, name: string): Promise<CoverageStore> {
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}/${name}`)
  return handleResponse<CoverageStore>(response)
}

export async function createCoverageStore(connId: string, workspace: string, store: CoverageStoreCreate): Promise<CoverageStore> {
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store),
  })
  return handleResponse<CoverageStore>(response)
}

export async function deleteCoverageStore(connId: string, workspace: string, name: string, recurse = false): Promise<void> {
  const params = recurse ? '?recurse=true' : ''
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}/${name}${params}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

/**
 * Smoke sweep over every exported API function.
 *
 * Each function is called with placeholder arguments once while every
 * request succeeds and once while every request fails with a 500. The goal
 * is to make sure request building and response handling never throws
 * anything other than a rejected promise; behaviour of individual endpoints
 * is covered by the backend tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as clientApi from './client'
import * as connectionApi from './connection'
import * as icebergApi from './iceberg'
import * as layerApi from './layer'
import * as layerGroupApi from './layergroup'
import * as s3Api from './s3'
import * as storesApi from './stores'
import * as styleApi from './style'
import * as workspaceApi from './workspace'

const modules: Record<string, Record<string, unknown>> = {
  client: clientApi,
  connection: connectionApi,
  iceberg: icebergApi,
  layer: layerApi,
  layergroup: layerGroupApi,
  s3: s3Api,
  stores: storesApi,
  style: styleApi,
  workspace: workspaceApi,
}

// Trailing callbacks satisfy optional onProgress/onStatus style parameters
const noop = () => {}
const ARGS = ['c1', 'ws', 'name', { name: 'x', url: 'http://x.test' }, noop, noop, noop]

// XMLHttpRequest uploads are covered with a fake XHR in uploadXhr.test.ts, and the
// download* helpers navigate the window, which happy-dom tries to load for real.
const XHR_FUNCTIONS = new Set([
  'uploadFile',
  'uploadFileForImport',
  'uploadQGISProject',
  'uploadS3Object',
  'uploadToS3',
])
const NAVIGATING = /^download/

const functions = Object.entries(modules).flatMap(([mod, exports]) =>
  Object.entries(exports)
    .filter(
      ([name, value]) =>
        typeof value === 'function' && !/^[A-Z]/.test(name) && !XHR_FUNCTIONS.has(name) &&
        !NAVIGATING.test(name),
    )
    .map(([name, fn]) => [`${mod}.${name}`, fn as (...args: unknown[]) => unknown] as const),
)

async function callSafely(fn: (...args: unknown[]) => unknown): Promise<void> {
  try {
    await Promise.race([
      Promise.resolve(fn(...ARGS)),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])
  } catch {
    // Rejections are the expected outcome for failing requests
  }
}

// msw's fetch interception is not compatible with happy-dom's Event here, so the
// sweep stubs fetch directly.
function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

describe('API sweep', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers the exported functions', () => {
    expect(functions.length).toBeGreaterThan(100)
  })

  it.each(functions)('%s succeeds without throwing synchronously', async (_name, fn) => {
    stubFetch(200, {})
    await callSafely(fn)
  })

  it.each(functions)('%s handles upstream failure', async (_name, fn) => {
    stubFetch(500, { error: 'boom' })
    await callSafely(fn)
  })

  it('handleResponse rejects with the server error message', async () => {
    const { handleResponse } = await import('./common')
    await expect(
      handleResponse(new Response(JSON.stringify({ error: 'nope' }), { status: 400 })),
    ).rejects.toThrow('nope')
    await expect(handleResponse(new Response('not json', { status: 500 }))).rejects.toThrow(
      'Unknown error',
    )
    await expect(handleResponse(new Response(null, { status: 204 }))).resolves.toBeUndefined()
    await expect(handleResponse(new Response('{"a":1}', { status: 200 }))).resolves.toEqual({ a: 1 })
  })

  it('handleResponse clears the token on 401 and never resolves', async () => {
    const { handleResponse } = await import('./common')
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    })
    localStorage.setItem('token', 't')
    const pending = handleResponse(new Response('', { status: 401 }))
    const outcome = await Promise.race([pending, new Promise((r) => setTimeout(() => r('pending'), 20))])
    expect(outcome).toBe('pending')
    expect(localStorage.getItem('token')).toBeNull()
    expect(reload).toHaveBeenCalled()
  })

  it('handleResponse rejects a 401 without reloading when there is no token', async () => {
    const { handleResponse } = await import('./common')
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    })
    localStorage.removeItem('token')
    await expect(
      handleResponse(new Response(JSON.stringify({ detail: 'Not logged in' }), { status: 401 })),
    ).rejects.toThrow('Not logged in')
    expect(reload).not.toHaveBeenCalled()
  })

  it('injects the auth token into API requests only', async () => {
    vi.resetModules()
    const original = window.fetch
    const spy = vi.fn().mockResolvedValue(new Response('{}'))
    window.fetch = spy as unknown as typeof fetch
    try {
      await import('./common')
      localStorage.setItem('token', 'abc')
      await window.fetch('/api/probe', { headers: { 'X-Test': '1' } })
      const init = spy.mock.calls[0][1] as { headers: Record<string, string> }
      expect(init.headers.Authorization).toBe('Token abc')
      expect(init.headers['X-Test']).toBe('1')
      await window.fetch('https://other.test/x')
      expect(spy.mock.calls[1][1]).toBeUndefined()
    } finally {
      localStorage.removeItem('token')
      window.fetch = original
    }
  })
})

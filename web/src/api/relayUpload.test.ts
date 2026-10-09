/**
 * Uploads relayed straight to GeoServer/GeoNode: chunks in order, a failed
 * one retried with backoff, then the target's answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RETRY_DELAYS, relayUpload, sendRelayChunks } from './relayUpload'

type Answer = { status: number; body: string } | 'error'

class FakeXHR {
  static instances: FakeXHR[] = []
  static answers: Answer[] = []

  status = 0
  responseText = ''
  method = ''
  url = ''
  sent: unknown = null
  headers: Record<string, string> = {}
  withCredentials = false
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null

  constructor() {
    FakeXHR.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: unknown) {
    this.sent = body
    const answer = FakeXHR.answers.shift() ?? { status: 200, body: '{}' }
    if (answer === 'error') {
      this.onerror?.()
      return
    }
    this.status = answer.status
    this.responseText = answer.body
    this.onload?.()
  }
}

const ok = (next: number): Answer => ({ status: 200, body: JSON.stringify({ next }) })
const file = new File(['0123456789'], 'roads.zip')
const started = { sessionId: 's1', chunkSize: 4, totalChunks: 3, storeName: 'roads' }
const noSleep = vi.fn(async () => {})

describe('relayed uploads', () => {
  const original = globalThis.XMLHttpRequest

  beforeEach(() => {
    FakeXHR.instances = []
    FakeXHR.answers = []
    noSleep.mockClear()
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = original
    vi.unstubAllGlobals()
  })

  it('sends every chunk in order as raw bytes', async () => {
    FakeXHR.answers = [ok(1), ok(2), ok(3)]
    const onChunkSent = vi.fn()
    await expect(sendRelayChunks(file, started, { onChunkSent, sleep: noSleep })).resolves.toBe(true)
    expect(FakeXHR.instances.map((x) => [x.method, x.url.split('/upload/')[1]])).toEqual([
      ['PUT', 'relay/s1/chunks/0'],
      ['PUT', 'relay/s1/chunks/1'],
      ['PUT', 'relay/s1/chunks/2'],
    ])
    expect(FakeXHR.instances[0].headers['Content-Type']).toBe('application/octet-stream')
    expect((FakeXHR.instances[2].sent as Blob).size).toBe(2)
    expect(onChunkSent).toHaveBeenLastCalledWith(3, 10)
  })

  it('sends a chunk again after a dropped connection or a gateway error', async () => {
    FakeXHR.answers = [ok(1), 'error', { status: 502, body: '<html>' }, ok(2), ok(3)]
    const onRetry = vi.fn()
    await sendRelayChunks(file, started, { onRetry, sleep: noSleep })
    expect(FakeXHR.instances.map((x) => x.url.split('/chunks/')[1])).toEqual(['0', '1', '1', '1', '2'])
    expect(onRetry.mock.calls.map(([attempt, delay]) => [attempt, delay])).toEqual([
      [1, 1],
      [2, 2],
    ])
    expect(noSleep.mock.calls).toEqual([[1000], [2000]])
  })

  it('gives up once the retries run out, before the relay would', async () => {
    FakeXHR.answers = Array(RETRY_DELAYS.length + 1).fill('error')
    await expect(sendRelayChunks(file, started, { sleep: noSleep })).rejects.toThrow(
      'start the upload again',
    )
    expect(FakeXHR.instances).toHaveLength(RETRY_DELAYS.length + 1)
    expect(RETRY_DELAYS.reduce((a, b) => a + b)).toBeLessThan(60)
  })

  it("doesn't retry what the relay refused", async () => {
    FakeXHR.answers = [{ status: 409, body: '{"error":"GeoServer said no"}' }]
    await expect(sendRelayChunks(file, started, { sleep: noSleep })).rejects.toThrow(
      /^GeoServer said no$/,
    )
    expect(FakeXHR.instances).toHaveLength(1)
  })

  it('stops when cancelled', async () => {
    let cancelled = false
    FakeXHR.answers = [ok(1)]
    const sent = sendRelayChunks(file, started, {
      sleep: noSleep,
      onChunkSent: () => {
        cancelled = true
      },
      isCancelled: () => cancelled,
    })
    await expect(sent).resolves.toBe(false)
    expect(FakeXHR.instances).toHaveLength(1)
  })

  it("starts the upload, sends it, then waits for the target's answer", async () => {
    const statuses = [
      { state: 'processing', error: '', result: null },
      { state: 'completed', error: '', result: { storeType: 'shapefile' } },
    ]
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body =
        init?.method === 'POST'
          ? { ...started, totalChunks: 1, chunkSize: 5 * 1024 * 1024 }
          : statuses.shift()
      expect(url).toContain('/upload/relay')
      return new Response(JSON.stringify(body), { status: init?.method === 'POST' ? 201 : 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    FakeXHR.answers = [ok(1)]

    const status = await relayUpload(
      file,
      { target: 'geoserver', connectionId: 'c1', workspace: 'ws', storeName: 'roads' },
      { sleep: noSleep },
    )
    expect(status?.result).toEqual({ storeType: 'shapefile' })
    const startBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(startBody).toMatchObject({ target: 'geoserver', filename: 'roads.zip', fileSize: 10 })
  })

  it('reports why the target refused the file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ ...started, totalChunks: 1 }), { status: 201 })
          : new Response(JSON.stringify({ state: 'failed', error: 'bad zip', result: null })),
      ),
    )
    FakeXHR.answers = [ok(1)]
    await expect(
      relayUpload(
        file,
        { target: 'geonode', connectionId: 'g1', uploadType: 'dataset' },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('bad zip')
  })
})

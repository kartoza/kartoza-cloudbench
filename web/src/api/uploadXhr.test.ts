/**
 * Tests for the XMLHttpRequest based upload helpers, using a fake XHR.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadFile, uploadFileForImport, uploadQGISProject } from './client'
import { uploadS3Object, uploadToS3 } from './s3'

type Listener = (event?: unknown) => void

class FakeXHR {
  static instances: FakeXHR[] = []
  static next: { status: number; body: string } | 'error' = { status: 200, body: '{}' }

  status = 0
  responseText = ''
  method = ''
  url = ''
  sent: unknown = null
  private listeners: Record<string, Listener[]> = {}
  private uploadListeners: Record<string, Listener[]> = {}
  upload = {
    addEventListener: (type: string, fn: Listener) => {
      this.uploadListeners[type] = [...(this.uploadListeners[type] ?? []), fn]
    },
  }

  constructor() {
    FakeXHR.instances.push(this)
  }

  addEventListener(type: string, fn: Listener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn]
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(body: unknown) {
    this.sent = body
    this.uploadListeners.progress?.forEach((fn) => fn({ lengthComputable: true, loaded: 1, total: 4 }))
    this.uploadListeners.progress?.forEach((fn) => fn({ lengthComputable: false, loaded: 0, total: 0 }))
    const next = FakeXHR.next
    if (next === 'error') {
      this.listeners.error?.forEach((fn) => fn())
      return
    }
    this.status = next.status
    this.responseText = next.body
    this.listeners.load?.forEach((fn) => fn())
  }
}

const file = new File(['abc'], 'a.gpkg')

describe('XHR upload helpers', () => {
  const original = globalThis.XMLHttpRequest

  beforeEach(() => {
    FakeXHR.instances = []
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = original
  })

  it('uploadFile resolves with the parsed body and reports progress', async () => {
    FakeXHR.next = { status: 200, body: '{"message":"ok"}' }
    const onProgress = vi.fn()
    await expect(uploadFile('c 1', 'ws', file, onProgress)).resolves.toEqual({ message: 'ok' })
    expect(onProgress).toHaveBeenCalledWith(25)
    expect(onProgress).toHaveBeenCalledTimes(1)
    const xhr = FakeXHR.instances[0]
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toContain('/upload?connId=c%201&workspace=ws')
    expect((xhr.sent as FormData).get('file')).toBeInstanceOf(File)
  })

  it('uploadFile rejects with the server error or a network error', async () => {
    FakeXHR.next = { status: 500, body: '{"error":"disk full"}' }
    await expect(uploadFile('c', 'ws', file)).rejects.toThrow('disk full')
    FakeXHR.next = { status: 500, body: '{}' }
    await expect(uploadFile('c', 'ws', file)).rejects.toThrow('Upload failed')
    FakeXHR.next = 'error'
    await expect(uploadFile('c', 'ws', file)).rejects.toThrow('Network error')
  })

  it('uploadFileForImport posts to the import endpoint', async () => {
    FakeXHR.next = { status: 200, body: '{"file_path":"/tmp/a","filename":"a","message":"m"}' }
    const onProgress = vi.fn()
    await expect(uploadFileForImport(file, onProgress)).resolves.toMatchObject({ filename: 'a' })
    expect(FakeXHR.instances[0].url).toContain('/pg/import/upload')
    expect(onProgress).toHaveBeenCalled()
    FakeXHR.next = { status: 400, body: '{"error":"bad file"}' }
    await expect(uploadFileForImport(file)).rejects.toThrow('bad file')
    FakeXHR.next = 'error'
    await expect(uploadFileForImport(file)).rejects.toThrow('Network error')
  })

  it('uploadQGISProject handles success and every failure shape', async () => {
    FakeXHR.next = { status: 201, body: '{"id":"p1"}' }
    const onProgress = vi.fn()
    await expect(uploadQGISProject(file, 'My project', onProgress)).resolves.toEqual({ id: 'p1' })
    expect(onProgress).toHaveBeenCalledWith(25)
    expect((FakeXHR.instances[0].sent as FormData).get('name')).toBe('My project')

    FakeXHR.next = { status: 200, body: 'not json' }
    await expect(uploadQGISProject(file)).rejects.toThrow('Invalid response from server')
    FakeXHR.next = { status: 400, body: '{"error":"nope"}' }
    await expect(uploadQGISProject(file)).rejects.toThrow('nope')
    FakeXHR.next = { status: 502, body: 'gateway' }
    await expect(uploadQGISProject(file)).rejects.toThrow('gateway')
    FakeXHR.next = { status: 502, body: '' }
    await expect(uploadQGISProject(file)).rejects.toThrow('HTTP 502')
    FakeXHR.next = 'error'
    await expect(uploadQGISProject(file)).rejects.toThrow('Network error')
  })

  it('uploadS3Object sends the object key and optional flags', async () => {
    FakeXHR.next = { status: 200, body: '{"key":"p/a.gpkg"}' }
    const onProgress = vi.fn()
    await expect(
      uploadS3Object('c1', 'bkt', file, 'p/', { convert: true, subfolder: true }, onProgress),
    ).resolves.toEqual({ key: 'p/a.gpkg' })
    const xhr = FakeXHR.instances[0]
    const form = xhr.sent as FormData
    expect(form.get('key')).toBe('p/a.gpkg')
    expect(form.get('convert')).toBe('true')
    expect(form.get('subfolder')).toBe('true')
    expect(xhr.url).toContain('/s3/connections/c1/buckets/bkt/objects')
    expect(onProgress).toHaveBeenCalledWith(25)

    FakeXHR.next = { status: 500, body: '{"error":"denied"}' }
    await expect(uploadS3Object('c1', 'bkt', file, '')).rejects.toThrow('denied')
    FakeXHR.next = { status: 500, body: '{}' }
    await expect(uploadS3Object('c1', 'bkt', file, '')).rejects.toThrow('Upload failed')
    FakeXHR.next = 'error'
    await expect(uploadS3Object('c1', 'bkt', file, '')).rejects.toThrow('Network error')
  })

  it('uploadToS3 sends only the options that were provided', async () => {
    FakeXHR.next = { status: 200, body: '{"ok":true}' }
    await uploadToS3('c1', 'bkt', file, 'k', false, 'parquet', vi.fn(), true, 'pre/')
    let form = FakeXHR.instances[0].sent as FormData
    expect(form.get('key')).toBe('k')
    expect(form.get('convert')).toBe('false')
    expect(form.get('targetFormat')).toBe('parquet')
    expect(form.get('subfolder')).toBe('true')
    expect(form.get('prefix')).toBe('pre/')

    await uploadToS3('c1', 'bkt', file)
    form = FakeXHR.instances[1].sent as FormData
    expect([...form.keys()]).toEqual(['file'])

    FakeXHR.next = { status: 400, body: '{"error":"bad"}' }
    await expect(uploadToS3('c1', 'bkt', file)).rejects.toThrow('bad')
    FakeXHR.next = 'error'
    await expect(uploadToS3('c1', 'bkt', file)).rejects.toThrow('Network error')
  })
})

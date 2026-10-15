/**
 * Tests for the XMLHttpRequest based upload helpers, using a fake XHR.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadFileForImport, uploadQGISProject } from './client'
import { uploadToS3 } from './s3'

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

  it('uploadToS3 sends only the options that were provided', async () => {
    FakeXHR.next = { status: 200, body: '{"ok":true}' }
    const onProgress = vi.fn()
    await expect(
      uploadToS3('c1', file, 'k', false, 'parquet', onProgress, true, 'pre/'),
    ).resolves.toEqual({ ok: true })
    const xhr = FakeXHR.instances[0]
    let form = xhr.sent as FormData
    expect(form.get('key')).toBe('k')
    expect(form.get('convert')).toBe('false')
    expect(form.get('targetFormat')).toBe('parquet')
    expect(form.get('subfolder')).toBe('true')
    expect(form.get('prefix')).toBe('pre/')
    expect(xhr.url).toContain('/s3/upload/c1')
    expect(onProgress).toHaveBeenCalledWith(25)

    await uploadToS3('c1', file)
    form = FakeXHR.instances[1].sent as FormData
    expect([...form.keys()]).toEqual(['file'])

    await uploadToS3('c1', file, undefined, true, 'cog', undefined, undefined, undefined, [], 'other', 'https://example.org/terms')
    form = FakeXHR.instances[2].sent as FormData
    expect(form.get('license')).toBe('other')
    expect(form.get('licenseUrl')).toBe('https://example.org/terms')
    expect(form.get('replace')).toBeNull() // only sent once an overwrite is confirmed

    await uploadToS3('c1', file, undefined, true, 'cog', undefined, undefined, undefined, [], 'other', undefined, true)
    form = FakeXHR.instances[3].sent as FormData
    expect(form.get('replace')).toBe('true')

    FakeXHR.next = { status: 400, body: '{"error":"bad"}' }
    await expect(uploadToS3('c1', file)).rejects.toThrow('bad')
    FakeXHR.next = { status: 500, body: '{}' }
    await expect(uploadToS3('c1', file)).rejects.toThrow('Upload failed')
    FakeXHR.next = 'error'
    await expect(uploadToS3('c1', file)).rejects.toThrow('Network error')
  })
})

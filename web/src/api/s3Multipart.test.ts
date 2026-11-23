/**
 * Uploads straight into the bucket: start, every chunk (a failed one sent
 * again), complete; and which uploads go that way.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  S3_RETRY_DELAYS,
  canUploadToS3Directly,
  inspectGeoPackageDirectly,
  uploadToS3Directly,
} from './s3Multipart'

type Answer = { status: number; body: string } | 'error'

class FakeXHR {
  static instances: FakeXHR[] = []
  static answers: Answer[] = []

  status = 0
  responseText = ''
  method = ''
  url = ''
  sent: unknown = null
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

  setRequestHeader() {}

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

const file = (name: string, size = 10) => new File(['x'.repeat(size)], name)
const noSleep = vi.fn(async () => {})
const started = { sessionId: 's1', filename: 'x', chunkSize: 4, totalChunks: 3, companions: [] as object[] }

describe('which uploads go straight to the bucket', () => {
  it.each([
    ['notes.pdf', [], undefined, true],
    ['dem.tif', [], 'cog', true],
    ['cloud.LAZ', [], 'copc', true],
    ['roads.geojson', [], 'pmtiles', true],
    ['roads.fgb', [], 'pmtiles', true],
    // A shapefile's parts are zipped in the bucket, a ZIP rewritten there.
    ['roads.shp', [file('roads.dbf')], undefined, true],
    ['roads.shp', [file('roads.dbf')], 'pmtiles', true],
    ['roads.zip', [], 'pmtiles', true],
    ['data.gpkg', [], 'inspect', true],
    // A GeoPackage converts through its inspection; several files are a shapefile only.
    ['data.gpkg', [], 'pmtiles', false],
    ['data.gpkg', [], 'cog', false],
    ['a.tif', [file('b.tif')], undefined, false],
    // A mosaic: two GeoTIFFs or more.
    ['a.tif', [file('b.tiff')], 'mosaic', true],
    ['a.tif', [], 'mosaic', false],
    ['a.tif', [file('b.png')], 'mosaic', false],
  ])('%s (%s, %s) -> %s', (name, companions, format, expected) => {
    expect(canUploadToS3Directly(file(name), companions as File[], format)).toBe(expected)
  })
})

describe('uploadToS3Directly', () => {
  const original = globalThis.XMLHttpRequest
  type FetchMock = ReturnType<typeof vi.fn<[string, RequestInit?], Promise<Response>>>
  let fetchMock: FetchMock

  beforeEach(() => {
    FakeXHR.instances = []
    FakeXHR.answers = []
    noSleep.mockClear()
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
    fetchMock = vi.fn<[string, RequestInit?], Promise<Response>>(async (url, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (url.endsWith('/complete')) {
        return new Response(JSON.stringify({ success: true, message: 'Done', key: 'a/x.tif' }), { status: 201 })
      }
      return new Response(JSON.stringify(started), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = original
    vi.unstubAllGlobals()
  })

  const calls = () =>
    fetchMock.mock.calls.map(([url, init]) => [init?.method, String(url).split('/s3/multipart/')[1]])

  it('starts, sends each chunk as raw bytes, then completes', async () => {
    const onProgress = vi.fn()
    const result = await uploadToS3Directly(
      'c1',
      file('dem.tif'),
      { key: 'a/dem.tif', targetFormat: 'cog', license: 'CC-BY-4.0', serverTypeId: 8 },
      { onProgress, sleep: noSleep },
    )
    expect(result).toMatchObject({ success: true, key: 'a/x.tif' })
    expect(FakeXHR.instances.map((x) => [x.method, x.url.split('/s3/multipart/')[1]])).toEqual([
      ['PUT', 'c1/s1/parts/0'],
      ['PUT', 'c1/s1/parts/1'],
      ['PUT', 'c1/s1/parts/2'],
    ])
    expect((FakeXHR.instances[2].sent as Blob).size).toBe(2)
    expect(calls()).toEqual([
      ['POST', 'c1'],
      ['POST', 'c1/s1/complete'],
    ])
    const startBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(startBody).toMatchObject({
      filename: 'dem.tif',
      fileSize: 10,
      key: 'a/dem.tif',
      convert: 'true',
      targetFormat: 'cog',
      license: 'CC-BY-4.0',
      serverTypeId: 8,
    })
    // Completed with the same fields, as the upload was started.
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ key: 'a/dem.tif', targetFormat: 'cog' })
  })

  it('sends a chunk again after a dropped connection or a bucket failure', async () => {
    FakeXHR.answers = [
      { status: 200, body: '{}' },
      'error',
      { status: 502, body: '{"error":"The bucket refused or failed"}' },
      { status: 200, body: '{}' },
    ]
    const onRetry = vi.fn()
    const onRecovered = vi.fn()
    await uploadToS3Directly('c1', file('a.bin'), {}, { onRetry, onRecovered, sleep: noSleep })
    expect(FakeXHR.instances.map((x) => x.url.split('/parts/')[1])).toEqual(['0', '1', '1', '1', '2'])
    expect(onRetry.mock.calls).toEqual([
      [1, 1],
      [2, 2],
    ])
    expect(onRecovered).toHaveBeenCalledOnce()
  })

  it('keeps retrying for minutes: S3 keeps the parts', () => {
    expect(S3_RETRY_DELAYS.reduce((a, b) => a + b)).toBeGreaterThanOrEqual(240)
  })

  it('aborts the upload when a chunk is refused', async () => {
    FakeXHR.answers = [{ status: 400, body: '{"error":"The file is not a valid TIFF."}' }]
    await expect(
      uploadToS3Directly('c1', file('dem.tif'), { targetFormat: 'cog' }, { sleep: noSleep }),
    ).rejects.toThrow(/^The file is not a valid TIFF\.$/)
    expect(calls()).toEqual([
      ['POST', 'c1'],
      ['DELETE', 'c1/s1'],
    ])
  })

  it('aborts the upload once the retries run out', async () => {
    FakeXHR.answers = Array(S3_RETRY_DELAYS.length + 1).fill('error')
    await expect(uploadToS3Directly('c1', file('a.bin'), {}, { sleep: noSleep })).rejects.toThrow(
      'Network error',
    )
    expect(calls().slice(-1)).toEqual([['DELETE', 'c1/s1']])
  })

  it('aborts the upload when cancelled', async () => {
    // Cancelled once the first chunk is sent.
    const result = await uploadToS3Directly(
      'c1',
      file('a.bin'),
      {},
      { sleep: noSleep, isCancelled: () => FakeXHR.instances.length > 0 },
    )
    expect(result).toBeNull()
    expect(FakeXHR.instances).toHaveLength(1)
    expect(calls()).toEqual([
      ['POST', 'c1'],
      ['DELETE', 'c1/s1'],
    ])
  })

  it("sends a shapefile's parts, each to its session, then completes the .shp", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            sessionId: 's1',
            filename: 'roads.shp',
            chunkSize: 4,
            totalChunks: 2,
            companions: [
              { sessionId: 's2', filename: 'roads.shx', chunkSize: 4, totalChunks: 1 },
              { sessionId: 's3', filename: 'roads.dbf', chunkSize: 4, totalChunks: 1 },
            ],
          }),
          { status: 201 },
        ),
    )
    const onProgress = vi.fn()
    await uploadToS3Directly(
      'c1',
      file('roads.shp', 6),
      { key: 'gis/roads.shp' },
      { onProgress, sleep: noSleep },
      [file('roads.shx', 3), file('roads.dbf', 2)],
    )
    const startBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(startBody.companions).toEqual([
      { filename: 'roads.shx', fileSize: 3 },
      { filename: 'roads.dbf', fileSize: 2 },
    ])
    expect(FakeXHR.instances.map((x) => x.url.split('/s3/multipart/')[1])).toEqual([
      'c1/s1/parts/0',
      'c1/s1/parts/1',
      'c1/s2/parts/0',
      'c1/s3/parts/0',
    ])
    expect(calls().slice(-1)).toEqual([['POST', 'c1/s1/complete']])
  })

  it('inspects a GeoPackage in the bucket', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.endsWith('/complete')
        ? new Response(JSON.stringify({ jobId: 's1', layers: [{ name: 'roads' }], rasterTables: [], key: 'k' }))
        : new Response(JSON.stringify({ ...started, totalChunks: 1 }), { status: 201 }),
    )
    const inspected = await inspectGeoPackageDirectly('c1', file('bali.gpkg'), { license: 'CC-BY-4.0' }, { sleep: noSleep })
    expect(inspected).toMatchObject({ jobId: 's1', layers: [{ name: 'roads' }] })
    const startBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(startBody).toMatchObject({ convert: 'true', targetFormat: 'inspect', license: 'CC-BY-4.0' })
  })
})

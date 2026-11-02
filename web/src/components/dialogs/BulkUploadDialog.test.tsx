import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BulkBatch, BulkFile, BulkPreview } from '../../api/bulk'

const api = vi.hoisted(() => ({
  listBulkFolders: vi.fn(),
  previewBulk: vi.fn(),
  startBulk: vi.fn(),
  getBulk: vi.fn(),
  cancelBulk: vi.fn(),
  retryBulk: vi.fn(),
  isActiveBatch: (batch: { status: string }) => batch.status === 'running' || batch.status === 'cancelling',
  BULK_BATCHES_QUERY_KEY: ['bulkBatches'],
}))
vi.mock('../../api/bulk', () => api)

const s3api = vi.hoisted(() => ({ getS3Connections: vi.fn() }))
vi.mock('../../api/s3', () => s3api)

import BulkUploadDialog from './BulkUploadDialog'
import { useUIStore } from '../../stores/uiStore'

const file = (name: string, kind: BulkFile['kind'], extra: Partial<BulkFile> = {}): BulkFile => ({
  key: `incoming/${name}`,
  name,
  size: 1024 * 1024,
  kind,
  target: kind ? `incoming/${name.replace(/\.[^.]+$/, '')}` : null,
  exists: false,
  ...extra,
})

const preview = (overrides: Partial<BulkPreview> = {}): BulkPreview => ({
  prefix: 'incoming/',
  files: [
    file('districts.zip', 'pmtiles'),
    file('dem.tif', 'cog', { exists: true }),
    file('survey.laz', 'copc'),
    file('buildings.shp', null, { skipReason: 'Loose shapefile part: zip the shapefile first' }),
  ],
  truncated: false,
  limits: { maxConcurrency: 4, onDemand: false },
  ...overrides,
})

const batch = (overrides: Partial<BulkBatch> = {}): BulkBatch => ({
  id: 'b-1',
  connectionId: 'c1',
  prefix: 'incoming/',
  status: 'running',
  concurrency: 2,
  onExists: 'skip',
  createdAt: '2026-11-02T10:00:00Z',
  completedAt: null,
  jobs: [
    {
      key: 'incoming/districts.zip',
      name: 'districts.zip',
      kind: 'pmtiles',
      status: 'running',
      progress: 40,
      message: 'Converting',
    },
    { key: 'incoming/survey.laz', name: 'survey.laz', kind: 'copc', status: 'queued', progress: 0, message: 'Waiting' },
  ],
  ...overrides,
})

function renderDialog(data: Record<string, unknown> = { connectionId: 'c1' }) {
  useUIStore.getState().openDialog('s3bulk', { mode: 'create', data })
  render(
    <ChakraProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BulkUploadDialog />
      </QueryClientProvider>
    </ChakraProvider>
  )
}

describe('BulkUploadDialog', () => {
  // fireEvent, not userEvent: user-event makes HTMLElement.focus getter-only (see src/test/setup.ts),
  // which breaks the checkboxes mounted later in the same test.
  // Every test file shares one process: let the modal's exit animation finish here.
  afterEach(async () => {
    act(() => useUIStore.getState().closeDialog())
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)))
    cleanup()
  })

  beforeEach(() => {
    Object.values(api).forEach(
      (fn) => typeof fn === 'function' && 'mockReset' in fn && (fn as ReturnType<typeof vi.fn>).mockReset()
    )
    s3api.getS3Connections.mockReset()
    s3api.getS3Connections.mockResolvedValue([
      { id: 'c1', name: 'Kartoza', endpoint: 'minio:9000', bucket: 'kartoza', useSSL: false, pathStyle: true },
      { id: 'c2', name: 'Sandbox', endpoint: 'minio:9000', bucket: 'sandbox', useSSL: false, pathStyle: true },
    ])
    api.listBulkFolders.mockImplementation(async (_conn: string, prefix: string) =>
      prefix === '' ? [{ prefix: 'incoming/', name: 'incoming' }] : [{ prefix: 'incoming/2026/', name: '2026' }]
    )
    api.previewBulk.mockResolvedValue(preview())
    api.startBulk.mockResolvedValue(batch())
    api.getBulk.mockResolvedValue(batch())
  })

  it('walks from a folder to the review, with what was found and the options', async () => {
    renderDialog()
    expect(screen.getByText('1 of 3 · Choose a folder')).toBeInTheDocument()
    // Nothing to review at the bucket's top level.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    fireEvent.click(await screen.findByRole('button', { name: 'Open incoming' }))
    await waitFor(() => expect(api.listBulkFolders).toHaveBeenCalledWith('c1', 'incoming/'))
    expect(await screen.findByRole('button', { name: 'Open 2026' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('2 of 3 · Review and options')).toBeInTheDocument()
    // The layers go to the top level, like other uploads' (checked against what is there).
    expect(api.previewBulk).toHaveBeenCalledWith('c1', 'incoming/', 'root', '', 'c1')
    expect(await screen.findByText(/3 layers found/)).toBeInTheDocument()
    expect(screen.getByTestId('bulk-summary')).toHaveTextContent('3 layers, 2 at a time.')
    // Files bulk upload leaves alone are listed with why; existing layers are flagged.
    expect(screen.getByText(/Loose shapefile part/)).toBeInTheDocument()
    expect(screen.getByText('Exists')).toBeInTheDocument()

    // Unticking a layer changes the summary.
    act(() => screen.getByLabelText('Convert survey.laz').click())
    await waitFor(() => expect(screen.getByLabelText('Convert survey.laz')).not.toBeChecked())
    expect(screen.getByTestId('bulk-summary')).toHaveTextContent('2 layers, 2 at a time.')
    expect(screen.getByText('License')).toBeInTheDocument()
    expect(screen.getByText('If a layer already exists')).toBeInTheDocument()
    expect(screen.getByText(/Processing servers: 2/)).toBeInTheDocument()
  })

  it('starts the batch as chosen and shows its progress', async () => {
    renderDialog({ connectionId: 'c1', prefix: 'incoming' })
    // Opened from a folder: it is already the one browsed.
    expect(screen.getByTestId('bulk-breadcrumb')).toHaveTextContent('incoming')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/3 layers found/)
    act(() => screen.getByLabelText('Convert dem.tif').click())

    fireEvent.click(screen.getByRole('button', { name: 'Start bulk upload' }))

    expect(await screen.findByText('3 of 3 · Progress')).toBeInTheDocument()
    expect(api.startBulk).toHaveBeenCalledWith('c1', {
      prefix: 'incoming/',
      files: ['incoming/districts.zip', 'incoming/survey.laz'],
      license: 'other',
      licenseUrl: '',
      destination: 'root',
      destinationPrefix: '',
      onExists: 'skip',
      concurrency: 2,
      sourceConnectionId: 'c1',
    })
    await waitFor(() => expect(screen.getByTestId('bulk-summary-line')).toHaveTextContent('0 of 2 done'))
    expect(screen.getByTestId('bulk-summary-line')).toHaveTextContent('1 running')
    expect(screen.getByText('districts.zip')).toBeInTheDocument()
    expect(screen.getByText(/keeps running, and shows in the Jobs panel/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel batch' })).toBeEnabled()
  })

  it('reads the folder from another registered bucket and publishes into the one opened from', async () => {
    renderDialog()
    const source = await screen.findByLabelText('Read the layers from')
    expect(source).toHaveValue('c1')
    expect(screen.getByText(/published into Kartoza, the bucket you opened this from/)).toBeInTheDocument()

    fireEvent.change(source, { target: { value: 'c2' } })
    await waitFor(() => expect(api.listBulkFolders).toHaveBeenCalledWith('c2', ''))
    expect(
      screen.getByText(/read from Sandbox, where they are, and the layers published into Kartoza/)
    ).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Open incoming' }))
    await waitFor(() => expect(api.listBulkFolders).toHaveBeenCalledWith('c2', 'incoming/'))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByText(/3 layers found/)
    expect(api.previewBulk).toHaveBeenCalledWith('c1', 'incoming/', 'root', '', 'c2')
    expect(screen.getByText(/Sandbox:\s*incoming\/\s*·/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start bulk upload' }))
    await screen.findByText('3 of 3 · Progress')
    expect(api.startBulk).toHaveBeenCalledWith('c1', expect.objectContaining({ sourceConnectionId: 'c2' }))
  })

  it('changing the source bucket goes back to its top level', async () => {
    renderDialog({ connectionId: 'c1', prefix: 'incoming/' })
    fireEvent.change(await screen.findByLabelText('Read the layers from'), { target: { value: 'c2' } })

    await waitFor(() => expect(screen.getByTestId('bulk-breadcrumb')).not.toHaveTextContent('incoming'))
    expect(api.listBulkFolders).toHaveBeenLastCalledWith('c2', '')
  })

  it('offers no other bucket when there is only one connection', async () => {
    s3api.getS3Connections.mockResolvedValue([
      { id: 'c1', name: 'Kartoza', endpoint: 'minio:9000', bucket: 'kartoza', useSSL: false, pathStyle: true },
    ])
    renderDialog()
    await screen.findByRole('button', { name: 'Open incoming' })

    expect(screen.queryByLabelText('Read the layers from')).not.toBeInTheDocument()
  })

  it('says why a folder cannot be read', async () => {
    api.previewBulk.mockRejectedValue(new Error('That folder is a Portolan catalog or one of its layers.'))
    renderDialog({ connectionId: 'c1', prefix: 'roads/' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/is a Portolan catalog/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  })

  it('reads the folder again for a destination folder, once it is typed', async () => {
    renderDialog({ connectionId: 'c1', prefix: 'incoming/' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/3 layers found/)

    // Beside each file, the layers that exist are other folders' than at the top level.
    act(() => screen.getByLabelText('Beside each file').click())
    await waitFor(() => expect(api.previewBulk).toHaveBeenLastCalledWith('c1', 'incoming/', 'beside', '', 'c1'))
    api.previewBulk.mockClear()
    act(() => screen.getByLabelText('Into one folder').click())
    const input = await screen.findByLabelText('Destination folder')
    fireEvent.change(input, { target: { value: 'published/2026' } })
    // Not on every key, nor before the folder has a name (the server would refuse it).
    expect(api.previewBulk).not.toHaveBeenCalled()
    fireEvent.blur(input)

    await waitFor(() =>
      expect(api.previewBulk).toHaveBeenLastCalledWith('c1', 'incoming/', 'folder', 'published/2026', 'c1')
    )
  })

  it('says bulk upload is not available with on-demand servers', async () => {
    api.previewBulk.mockResolvedValue(preview({ limits: { maxConcurrency: 4, onDemand: true } }))
    renderDialog({ connectionId: 'c1', prefix: 'incoming/' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/doesn't support on-demand servers yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start bulk upload' })).toBeDisabled()
  })

  it('shows why a batch could not be started', async () => {
    api.startBulk.mockRejectedValue(new Error('A bulk upload is already running: wait for it, or cancel it.'))
    renderDialog({ connectionId: 'c1', prefix: 'incoming/' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/3 layers found/)

    fireEvent.click(screen.getByRole('button', { name: 'Start bulk upload' }))

    expect(await screen.findByText(/already running/)).toBeInTheDocument()
    expect(screen.getByText('2 of 3 · Review and options')).toBeInTheDocument()
  })

  it('reopens on a running batch from the Jobs panel, and can retry failures', async () => {
    api.getBulk.mockResolvedValue(
      batch({
        status: 'partial',
        jobs: [
          {
            key: 'k1',
            name: 'a.zip',
            kind: 'pmtiles',
            status: 'failed',
            progress: 30,
            message: 'x',
            error: 'the shapefile is missing its .shx',
          },
          { key: 'k2', name: 'b.tif', kind: 'cog', status: 'completed', progress: 100, message: 'Published' },
        ],
      })
    )
    api.retryBulk.mockResolvedValue(batch())
    renderDialog({ connectionId: 'c1', batchId: 'b-1' })

    expect(await screen.findByText('3 of 3 · Progress')).toBeInTheDocument()
    expect(await screen.findByText(/missing its .shx/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed (1)' }))
    await waitFor(() => expect(api.retryBulk).toHaveBeenCalledWith('b-1'))
  })

  it('says when a batch is gone', async () => {
    api.getBulk.mockRejectedValue(new Error('Bulk upload not found'))
    renderDialog({ connectionId: 'c1', batchId: 'b-missing' })

    expect(await screen.findByText(/no longer here/)).toBeInTheDocument()
  })
})

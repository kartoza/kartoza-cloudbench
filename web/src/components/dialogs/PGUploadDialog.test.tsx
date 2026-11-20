import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  getOGR2OGRStatus: vi.fn(),
  detectLayers: vi.fn(),
  startVectorImport: vi.fn(),
  startRasterImport: vi.fn(),
}))
vi.mock('../../api', () => api)

const chunked = vi.hoisted(() => ({
  CHUNK_SIZE: 1024,
  initUploadSession: vi.fn(),
  uploadChunk: vi.fn(),
  completePGUpload: vi.fn(),
  cancelUpload: vi.fn(),
}))
vi.mock('../../api/chunkedUpload', () => chunked)

import PGUploadDialog from './PGUploadDialog'
import { useUIStore } from '../../stores/uiStore'

async function openAndUpload() {
  useUIStore
    .getState()
    .openDialog('pgupload', { mode: 'create', data: { serviceName: 'svc', schemaName: 'public' } })
  render(
    <ChakraProvider>
      <QueryClientProvider client={new QueryClient()}>
        <PGUploadDialog />
      </QueryClientProvider>
    </ChakraProvider>
  )
  const input = await waitFor(() => {
    const el = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(el).not.toBeNull()
    return el
  })
  fireEvent.change(input, { target: { files: [new File(['x'], 'bali_districts_shp.zip')] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Upload' }))
}

describe('PGUploadDialog', () => {
  afterEach(async () => {
    act(() => useUIStore.getState().closeDialog())
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)))
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    const mocks = [...Object.values(api), ...Object.values(chunked)]
    mocks.forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
    })
    api.getOGR2OGRStatus.mockResolvedValue({ available: true })
    api.startVectorImport.mockResolvedValue({ status: 'completed' })
    chunked.initUploadSession.mockResolvedValue({ sessionId: 'sess-1', totalChunks: 1 })
    chunked.uploadChunk.mockResolvedValue(undefined)
    chunked.completePGUpload.mockResolvedValue({ path: '/uploads/sess-1/bali_districts_shp.zip' })
    chunked.cancelUpload.mockResolvedValue(undefined)
  })

  it('uses the detected layer name for source layer and table', async () => {
    api.detectLayers.mockResolvedValue([{ name: 'bali_districts' }])
    await openAndUpload()

    expect(await screen.findByText('Layers to Import')).toBeInTheDocument()
    expect(screen.getByDisplayValue('bali_districts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Import to PostgreSQL/ }))

    await waitFor(() =>
      expect(api.startVectorImport).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceLayer: 'bali_districts',
          tableName: 'bali_districts',
          cleanupSource: true,
        })
      )
    )
  })

  it('shows an error instead of inventing a layer when detection fails', async () => {
    api.detectLayers.mockRejectedValue(new Error('ogrinfo failed'))
    await openAndUpload()

    const alert = await screen.findByText(/Could not read layers/)
    expect(alert).toHaveTextContent('ogrinfo failed')
    expect(screen.queryByText('Layers to Import')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('bali_districts_shp')).not.toBeInTheDocument()
    expect(chunked.cancelUpload).toHaveBeenCalledWith('sess-1')
    expect(screen.queryByRole('button', { name: /Import to PostgreSQL/ })).not.toBeInTheDocument()
  })

  it('shows an error when no layers are detected', async () => {
    api.detectLayers.mockResolvedValue([])
    await openAndUpload()

    expect(await screen.findByText(/No layers found/)).toBeInTheDocument()
    expect(screen.queryByText('Layers to Import')).not.toBeInTheDocument()
  })
})

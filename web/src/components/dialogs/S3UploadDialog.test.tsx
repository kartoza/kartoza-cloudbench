import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  getConversionToolStatus: vi.fn(),
  checkPortolanTarget: vi.fn(),
  uploadToS3: vi.fn(),
  uploadMosaic: vi.fn(),
  getConversionJob: vi.fn(),
  inspectGeoPackage: vi.fn(),
  convertGeoPackage: vi.fn(),
  cancelGeoPackageInspection: vi.fn(),
}))
vi.mock('../../api', () => api)

import S3UploadDialog from './S3UploadDialog'
import { useUIStore } from '../../stores/uiStore'

const completedJob = {
  id: 'job-1',
  sourcePath: 's3://bucket/relief.tif',
  outputPath: 's3://bucket/relief/relief.tif',
  sourceFormat: 'tiff',
  targetFormat: 'cog',
  status: 'completed',
  progress: 100,
  message: 'Done',
  startedAt: '2026-10-01T00:00:00Z',
  inputSize: 4,
}

describe('S3UploadDialog', () => {
  // Every test file shares one process (vitest.config singleFork): close the
  // modal and let its exit animation finish, as S3ConnectionDialog.test does.
  afterEach(async () => {
    act(() => useUIStore.getState().closeDialog())
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)))
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getConversionToolStatus.mockResolvedValue({ cloudnativegis: { available: true } })
    api.checkPortolanTarget.mockResolvedValue({ exists: false })
    api.uploadToS3.mockResolvedValue({ success: true, message: 'Accepted', conversionJobId: 'job-1' })
    api.getConversionJob.mockResolvedValue(completedJob)
  })

  it('handles a finished conversion once, without an update loop', async () => {
    const consoleError = vi.spyOn(console, 'error')
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    useUIStore.getState().openDialog('s3upload', { mode: 'create', data: { connectionId: 'conn-1' } })
    render(
      <ChakraProvider>
        <QueryClientProvider client={queryClient}>
          <S3UploadDialog />
        </QueryClientProvider>
      </ChakraProvider>
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['II*\u0000'], 'relief.tif', { type: 'image/tiff' })] },
    })
    const upload = await screen.findByRole('button', { name: 'Upload' })
    await waitFor(() => expect(upload).toBeEnabled())
    await userEvent.click(upload)

    await waitFor(() => expect(api.getConversionJob).toHaveBeenCalledWith('job-1'))
    // Long enough for a loop to show: it re-ran on every render.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))

    const loops = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes('Maximum update depth')
    )
    expect(loops).toEqual([])
    // The bucket listing is refreshed when the upload is accepted and once
    // more when the job finishes - not on every render.
    const refreshes = invalidate.mock.calls.filter(
      ([filters]) => (filters?.queryKey as unknown[] | undefined)?.[0] === 's3objects'
    )
    expect(refreshes).toHaveLength(2)
  })

  it('converts a LAS/LAZ point cloud to COPC', async () => {
    useUIStore.getState().openDialog('s3upload', { mode: 'create', data: { connectionId: 'conn-1' } })
    render(
      <ChakraProvider>
        <QueryClientProvider client={new QueryClient()}>
          <S3UploadDialog />
        </QueryClientProvider>
      </ChakraProvider>
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['LASF'], 'autzen.laz', { type: 'application/octet-stream' })] },
    })
    const upload = await screen.findByRole('button', { name: 'Upload' })
    await waitFor(() => expect(upload).toBeEnabled())
    await userEvent.click(upload)

    await waitFor(() => expect(api.uploadToS3).toHaveBeenCalled())
    const [, file, , convert, targetFormat] = api.uploadToS3.mock.calls[0]
    expect(file.name).toBe('autzen.laz')
    expect(convert).toBe(true)
    expect(targetFormat).toBe('copc')
  })

  describe('on demand', () => {
    const cx23 = {
      id: 72, type: 'cx23', location: 'hel1', specifications: { cores: 2, memory: 4, disk: 40 },
      currency: 'EUR', price: '0.0106',
    }

    async function uploadButton(servers: object[]) {
      api.getConversionToolStatus.mockResolvedValue({
        cloudnativegis: { available: true, onDemand: true, servers },
      })
      useUIStore.getState().openDialog('s3upload', { mode: 'create', data: { connectionId: 'conn-1' } })
      render(
        <ChakraProvider>
          <QueryClientProvider client={new QueryClient()}>
            <S3UploadDialog />
          </QueryClientProvider>
        </ChakraProvider>
      )
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, {
        target: { files: [new File(['II*\u0000'], 'relief.tif', { type: 'image/tiff' })] },
      })
      await screen.findByText('Conversion server')
      return screen.findByRole('button', { name: 'Upload' })
    }

    it('disables Upload without a conversion server to pick', async () => {
      const upload = await uploadButton([{ ...cx23, available: false }])
      expect(upload).toBeDisabled()
    })

    it('lists each server with its disk', async () => {
      await uploadButton([{ ...cx23, available: true }])
      expect(
        screen.getByRole('option', { name: 'cx23 · hel1 · 2 vCPU / 4 GB · 40 GB disk · 0.0106 EUR/h' })
      ).toBeInTheDocument()
    })

    it('enables Upload with one in stock, and sends it', async () => {
      const upload = await uploadButton([{ ...cx23, available: false }, { ...cx23, id: 8, available: true }])
      await waitFor(() => expect(upload).toBeEnabled())
      await userEvent.click(upload)

      await waitFor(() => expect(api.uploadToS3).toHaveBeenCalled())
      expect(api.uploadToS3.mock.calls[0].at(-1)).toBe(8)
    })
  })
})

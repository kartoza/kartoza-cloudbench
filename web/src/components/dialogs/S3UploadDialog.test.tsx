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
})

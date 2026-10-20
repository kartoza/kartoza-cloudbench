import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  getConversionToolStatus: vi.fn(),
  getConversionServers: vi.fn(),
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
      id: 72, location: 'hel1', specifications: { cores: 2, memory: 4, disk: 40 },
      currency: 'EUR', price: '0.0106',
    }

    async function uploadButton(servers: object[], instanceServers: object[] = []) {
      api.getConversionToolStatus.mockResolvedValue({
        cloudnativegis: {
          available: true, onDemand: true, servers,
          serversUrl: 'http://geohosting/#/dashboard/server-on-demand',
        },
      })
      api.getConversionServers.mockResolvedValue(instanceServers)
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
      await screen.findByText(instanceServers.length ? 'Existing Server' : 'Server type')
      return screen.findByRole('button', { name: 'Upload' })
    }

    it('disables Upload without a conversion server to pick', async () => {
      const upload = await uploadButton([{ ...cx23, available: false }])
      expect(upload).toBeDisabled()
    })

    it('lists each server with its disk', async () => {
      await uploadButton([{ ...cx23, available: true }])
      expect(
        screen.getByRole('option', { name: 'hel1 · 2 vCPU / 4 GB · 40 GB disk · 0.0106 EUR/h' })
      ).toBeInTheDocument()
    })

    it('enables Upload with one in stock, and sends it', async () => {
      const upload = await uploadButton([{ ...cx23, available: false }, { ...cx23, id: 8, available: true }])
      await waitFor(() => expect(upload).toBeEnabled())
      await userEvent.click(upload)
      // Warned first what becomes of the new server.
      expect(await screen.findByText('The server will be destroyed after this job')).toBeInTheDocument()
      expect(api.uploadToS3).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => expect(api.uploadToS3).toHaveBeenCalled())
      const [serverTypeId, autoDestroy, instanceServerId] = api.uploadToS3.mock.calls[0].slice(-3)
      expect(serverTypeId).toBe(8)
      // A new server, auto destroyed by default.
      expect(autoDestroy).toBe(true)
      expect(instanceServerId).toBeUndefined()
    })

    it('keeps the server running with Auto destroy off', async () => {
      const upload = await uploadButton([{ ...cx23, available: true }])
      expect(screen.getByText('Auto destroy will destroy the server when this job is done.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Auto destroy' }))
      expect(screen.getByText('The server keeps running (and billed) after this job is done.')).toBeInTheDocument()
      await waitFor(() => expect(upload).toBeEnabled())
      await userEvent.click(upload)
      expect(await screen.findByText('The server will keep running')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Server on Demand' })).toHaveAttribute(
        'href', 'http://geohosting/#/dashboard/server-on-demand'
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() => expect(api.uploadToS3).toHaveBeenCalled())
      expect(api.uploadToS3.mock.calls[0].at(-2)).toBe(false)
    })

    it('uploads nothing when the server warning is cancelled', async () => {
      const upload = await uploadButton([{ ...cx23, available: true }])
      await waitFor(() => expect(upload).toBeEnabled())
      await userEvent.click(upload)
      await screen.findByText('The server will be destroyed after this job')
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() =>
        expect(screen.queryByText('The server will be destroyed after this job')).not.toBeInTheDocument()
      )
      expect(api.uploadToS3).not.toHaveBeenCalled()
    })

    const kept = {
      instanceId: 'aaaaaaaa-1111-2222-3333-444444444444', status: 'ready', autoDestroy: false,
      typeId: 72, specification: { cores: 2, memory: 4, disk: 40 }, created: null, jobs: 1,
    }
    const destroyed = { ...kept, instanceId: 'bbbbbbbb-1111-2222-3333-444444444444', autoDestroy: true }

    it('lists running servers, an auto destroy one disabled', async () => {
      await uploadButton([{ ...cx23, available: true }], [kept, destroyed])
      await screen.findByRole('option', { name: 'aaaaaaaa · 2 vCPU / 4 GB · 40 GB disk · 1 job' })
      expect(screen.getByRole('option', { name: 'Create new server' })).toBeInTheDocument()
      expect(
        screen.getByRole('option', { name: 'bbbbbbbb · 2 vCPU / 4 GB · 40 GB disk · 1 job — auto destroy' })
      ).toBeDisabled()
    })

    it('picks the first running server that can be picked by default', async () => {
      await uploadButton([{ ...cx23, available: true }], [destroyed, kept])
      await screen.findByRole('option', { name: /^aaaaaaaa/ })
      expect(screen.getByRole('combobox', { name: 'Existing Server' })).toHaveValue(kept.instanceId)
    })

    it('starts a new server when "Create new server" is picked', async () => {
      await uploadButton([{ ...cx23, available: true }], [kept])
      await screen.findByRole('option', { name: /^aaaaaaaa/ })
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Existing Server' }), '')
      expect(await screen.findByText('Server type')).toBeInTheDocument()
    })

    it('runs on a running server picked, without a new one', async () => {
      const upload = await uploadButton([{ ...cx23, available: true }], [kept])
      await screen.findByRole('option', { name: /^aaaaaaaa/ })
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Existing Server' }), kept.instanceId)
      // No server type or auto destroy to pick for it.
      expect(screen.queryByText('Server type')).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Auto destroy' })).not.toBeInTheDocument()
      await waitFor(() => expect(upload).toBeEnabled())
      await userEvent.click(upload)

      await waitFor(() => expect(api.uploadToS3).toHaveBeenCalled())
      expect(api.uploadToS3.mock.calls[0].slice(-3)).toEqual([undefined, undefined, kept.instanceId])
    })
  })
})

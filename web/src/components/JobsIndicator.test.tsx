import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversionJob } from '../types'
import type { BulkBatch } from '../api/bulk'
import { useUIStore } from '../stores/uiStore'

const toast = vi.fn()
vi.mock('@chakra-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chakra-ui/react')>()
  return { ...actual, useToast: () => toast }
})

const getConversionJobs = vi.fn()
vi.mock('../api', () => ({ getConversionJobs: () => getConversionJobs() }))

const listBulk = vi.fn()
vi.mock('../api/bulk', () => ({
  listBulk: () => listBulk(),
  cancelBulk: vi.fn(),
  isActiveBatch: (batch: { status: string }) => batch.status === 'running' || batch.status === 'cancelling',
  BULK_BATCHES_QUERY_KEY: ['bulkBatches'],
}))

import JobsIndicator, { CONVERSION_JOBS_QUERY_KEY } from './JobsIndicator'

function job(id: string, status: ConversionJob['status'], extra: Partial<ConversionJob> = {}): ConversionJob {
  return {
    id,
    sourcePath: `${id}.zip`,
    outputPath: null,
    sourceFormat: 'shapefile',
    targetFormat: 'pmtiles',
    status,
    progress: status === 'completed' ? 100 : 40,
    message: status === 'completed' ? 'Published 1 layer to the catalog' : 'Converting',
    error: '',
    startedAt: new Date().toISOString(),
    inputSize: 1,
    ...extra,
  }
}

function renderIndicator(client: QueryClient) {
  return render(
    <ChakraProvider>
      <QueryClientProvider client={client}>
        <JobsIndicator />
      </QueryClientProvider>
    </ChakraProvider>
  )
}

describe('JobsIndicator', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    toast.mockReset()
    getConversionJobs.mockReset()
    getConversionJobs.mockResolvedValue([])
    listBulk.mockReset()
    listBulk.mockResolvedValue([])
  })
  afterEach(() => client.clear())

  it('shows the server a job runs on, with its status', async () => {
    const server = {
      instanceId: 'aaaaaaaa-1111-2222-3333-444444444444',
      status: 'ready' as const,
      autoDestroy: false,
      typeId: 72,
      specification: { cores: 2, memory: 4, disk: 40 },
      label: 'hel1 · 2 vCPU / 4 GB · 40 GB disk',
      created: null,
      jobs: 2,
    }
    getConversionJobs.mockResolvedValue([job('a', 'polling', { server }), job('b', 'completed')])
    renderIndicator(client)
    await screen.findByText('1')
    fireEvent.click(document.querySelector('button[aria-controls^="popover-content"]') as HTMLElement)
    expect(await screen.findByText('aaaaaaaa · hel1 · 2 vCPU / 4 GB · 40 GB disk · 2 jobs - ready')).toBeInTheDocument()
    // Only under the job that has one.
    expect(screen.getAllByText(/ - ready$/)).toHaveLength(1)
  })

  it('shows how many conversions are running', async () => {
    getConversionJobs.mockResolvedValue([job('a', 'polling'), job('b', 'pending'), job('c', 'completed')])
    renderIndicator(client)
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('announces a job it saw running once it finishes', async () => {
    getConversionJobs.mockResolvedValue([job('a', 'polling')])
    renderIndicator(client)
    await screen.findByText('1')

    getConversionJobs.mockResolvedValue([job('a', 'completed')])
    await act(() => client.invalidateQueries({ queryKey: CONVERSION_JOBS_QUERY_KEY }))

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: 'a.zip: conversion finished',
      status: 'success',
    })
  })

  it('does not announce jobs that had already finished before the page loaded', async () => {
    getConversionJobs.mockResolvedValue([job('a', 'completed'), job('b', 'failed', { error: 'boom' })])
    renderIndicator(client)
    await waitFor(() => expect(getConversionJobs).toHaveBeenCalled())
    await act(() => client.invalidateQueries({ queryKey: CONVERSION_JOBS_QUERY_KEY }))
    expect(toast).not.toHaveBeenCalled()
  })

  describe('bulk uploads', () => {
    function batch(status: BulkBatch['status'], extra: Partial<BulkBatch> = {}): BulkBatch {
      return {
        id: 'b-1',
        connectionId: 'c1',
        prefix: 'incoming/',
        status,
        concurrency: 2,
        onExists: 'skip',
        createdAt: new Date().toISOString(),
        completedAt: null,
        jobs: [
          {
            key: 'k1',
            name: 'a.zip',
            kind: 'pmtiles',
            status: status === 'running' ? 'running' : 'completed',
            progress: 50,
            message: 'x',
          },
          {
            key: 'k2',
            name: 'b.tif',
            kind: 'cog',
            status: status === 'running' ? 'queued' : 'completed',
            progress: 0,
            message: 'x',
          },
        ],
        ...extra,
      }
    }

    it('is one entry however many layers it converts, and counts as running', async () => {
      listBulk.mockResolvedValue([batch('running')])
      renderIndicator(client)
      await screen.findByText('1')
      fireEvent.click(document.querySelector('button[aria-controls^="popover-content"]') as HTMLElement)

      expect(await screen.findByText('Bulk upload: incoming/')).toBeInTheDocument()
      expect(screen.getByText('0 of 2 done · 1 running')).toBeInTheDocument()
      expect(screen.getByText(/2 layers · 2 at a time/)).toBeInTheDocument()
    })

    it('opens the bulk upload dialog on that batch', async () => {
      listBulk.mockResolvedValue([batch('running')])
      renderIndicator(client)
      await screen.findByText('1')
      fireEvent.click(document.querySelector('button[aria-controls^="popover-content"]') as HTMLElement)

      fireEvent.click(await screen.findByRole('button', { name: 'Open' }))

      const { activeDialog, dialogData } = useUIStore.getState()
      expect(activeDialog).toBe('s3bulk')
      expect(dialogData?.data).toEqual({ connectionId: 'c1', batchId: 'b-1' })
    })

    it('announces a bulk upload it saw running once it finishes, and refreshes the listings', async () => {
      const invalidate = vi.spyOn(client, 'invalidateQueries')
      listBulk.mockResolvedValue([batch('running')])
      renderIndicator(client)
      await screen.findByText('1')

      listBulk.mockResolvedValue([batch('completed')])
      await act(() => client.invalidateQueries({ queryKey: ['bulkBatches'] }))

      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
      expect(toast.mock.calls[0][0]).toMatchObject({
        title: 'Bulk upload of incoming/: finished',
        description: '2 of 2 done',
        status: 'success',
      })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['s3objects'] })
    })

    it('does not announce bulk uploads that had finished before the page loaded', async () => {
      listBulk.mockResolvedValue([batch('completed')])
      renderIndicator(client)
      await waitFor(() => expect(listBulk).toHaveBeenCalled())
      await act(() => client.invalidateQueries({ queryKey: ['bulkBatches'] }))
      expect(toast).not.toHaveBeenCalled()
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversionJob } from '../types'

const toast = vi.fn()
vi.mock('@chakra-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chakra-ui/react')>()
  return { ...actual, useToast: () => toast }
})

const getConversionJobs = vi.fn()
vi.mock('../api', () => ({ getConversionJobs: () => getConversionJobs() }))

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
  })
  afterEach(() => client.clear())

  it('shows how many conversions are running', async () => {
    getConversionJobs.mockResolvedValue([job('a', 'running'), job('b', 'pending'), job('c', 'completed')])
    renderIndicator(client)
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('announces a job it saw running once it finishes', async () => {
    getConversionJobs.mockResolvedValue([job('a', 'running')])
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
})

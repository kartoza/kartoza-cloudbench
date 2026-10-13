import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ChunkLoopHandlers, RelayStarted } from '../../api/relayUpload'

const relay = vi.hoisted(() => ({
  relayUpload: vi.fn(),
  cancelRelayUpload: vi.fn(),
}))
vi.mock('../../api/relayUpload', () => relay)

import UploadDialog from './UploadDialog'
import { useUIStore } from '../../stores/uiStore'

type Handlers = ChunkLoopHandlers & { onStarted?: (started: RelayStarted) => void }

describe('UploadDialog', () => {
  afterEach(async () => {
    act(() => useUIStore.getState().closeDialog())
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)))
    cleanup()
  })

  beforeEach(() => {
    relay.relayUpload.mockReset()
    relay.cancelRelayUpload.mockReset().mockResolvedValue(undefined)
  })

  it('cancels the upload when closed while uploading', async () => {
    let handlers: Handlers = {}
    let finish: (value: null) => void = () => {}
    relay.relayUpload.mockImplementation((_file: File, _target: unknown, h: Handlers) => {
      handlers = h
      h.onStarted?.({ sessionId: 's1', chunkSize: 4, totalChunks: 3, storeName: 'dem' })
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    useUIStore
      .getState()
      .openDialog('upload', { mode: 'create', data: { connectionId: 'c1', workspace: 'ws' } })
    render(
      <ChakraProvider>
        <QueryClientProvider client={new QueryClient()}>
          <UploadDialog />
        </QueryClientProvider>
      </ChakraProvider>
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['0123456789'], 'dem.tif')] } })
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(relay.relayUpload).toHaveBeenCalled())

    // The footer's Cancel closes the dialog, as the X does.
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).slice(-1)[0])

    expect(useUIStore.getState().activeDialog).toBeNull()
    expect(relay.cancelRelayUpload).toHaveBeenCalledWith('s1')
    expect(handlers.isCancelled?.()).toBe(true)

    // Reopened, the dialog is fresh, and the old upload ending leaves it alone.
    act(() =>
      useUIStore
        .getState()
        .openDialog('upload', { mode: 'create', data: { connectionId: 'c1', workspace: 'ws' } })
    )
    await act(async () => finish(null))
    expect(screen.queryByText(/cancelled/i)).toBeNull()
  })
})

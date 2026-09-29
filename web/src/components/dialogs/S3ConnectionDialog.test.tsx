import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  getS3Connection: vi.fn(),
  createS3Connection: vi.fn(),
  updateS3Connection: vi.fn(),
  testS3ConnectionDirect: vi.fn(),
}))
vi.mock('../../api', () => api)

import S3ConnectionDialog from './S3ConnectionDialog'
import { useUIStore } from '../../stores/uiStore'

function renderDialog() {
  render(
    <ChakraProvider>
      <QueryClientProvider client={new QueryClient()}>
        <S3ConnectionDialog />
      </QueryClientProvider>
    </ChakraProvider>
  )
}

async function fillNewConnection() {
  await userEvent.type(await screen.findByLabelText(/Connection Name/), 'MinIO')
  await userEvent.type(screen.getByLabelText(/^Bucket/), 'data')
  await userEvent.type(screen.getByLabelText(/^Access Key/), 'key')
  await userEvent.type(screen.getByLabelText(/^Secret Key/), 'secret')
}

describe('S3ConnectionDialog', () => {
  // Every test file shares one process (vitest.config singleFork): close the
  // modal and let its exit animation and focus handling finish here, or that
  // pending React work runs during - and breaks - the next file's tests.
  afterEach(async () => {
    act(() => useUIStore.getState().closeDialog())
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)))
    cleanup()
  })

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.createS3Connection.mockResolvedValue({ id: 'new' })
    api.updateS3Connection.mockResolvedValue(undefined)
  })

  it('only adds a connection once a test has passed', async () => {
    useUIStore.getState().openDialog('s3connection', { mode: 'create' })
    renderDialog()
    await fillNewConnection()
    const add = screen.getByRole('button', { name: 'Add Connection' })
    expect(add).toBeDisabled()

    // A failing test still doesn't allow it.
    api.testS3ConnectionDirect.mockRejectedValueOnce(new Error('403 Forbidden'))
    await userEvent.click(screen.getByRole('button', { name: /Test Connection/ }))
    expect(await screen.findByText('403 Forbidden')).toBeInTheDocument()
    expect(add).toBeDisabled()

    api.testS3ConnectionDirect.mockResolvedValueOnce({ status: 'success', message: 'Connection successful' })
    await userEvent.click(screen.getByRole('button', { name: /Test Connection/ }))
    await waitFor(() => expect(add).toBeEnabled())

    await userEvent.click(add)
    expect(api.createS3Connection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'MinIO', bucket: 'data', accessKey: 'key', secretKey: 'secret' })
    )
  })

  it('asks for a new test when the settings change after one passed', async () => {
    useUIStore.getState().openDialog('s3connection', { mode: 'create' })
    renderDialog()
    await fillNewConnection()
    api.testS3ConnectionDirect.mockResolvedValue({ status: 'success', message: 'Connection successful' })
    await userEvent.click(screen.getByRole('button', { name: /Test Connection/ }))
    const add = screen.getByRole('button', { name: 'Add Connection' })
    await waitFor(() => expect(add).toBeEnabled())

    await userEvent.type(screen.getByLabelText(/^Bucket/), '-typo')
    expect(add).toBeDisabled()
    expect(screen.getByText(/settings changed since the last test/)).toBeInTheDocument()

    // Changing it back to what was tested is fine again.
    await userEvent.clear(screen.getByLabelText(/^Bucket/))
    await userEvent.type(screen.getByLabelText(/^Bucket/), 'data')
    expect(add).toBeEnabled()
  })

  it('saves an edit that keeps the saved settings without a test', async () => {
    api.getS3Connection.mockResolvedValue({
      id: 'c1',
      name: 'MinIO',
      endpoint: 'minio:9000',
      bucket: 'data',
      region: '',
      useSSL: false,
      pathStyle: true,
      contactEmail: '',
    })
    useUIStore.getState().openDialog('s3connection', { mode: 'edit', data: { connectionId: 'c1' } })
    renderDialog()
    const name = await screen.findByLabelText(/Connection Name/)
    await waitFor(() => expect(name).toHaveValue('MinIO'))
    const save = screen.getByRole('button', { name: 'Save Changes' })

    await userEvent.type(name, ' renamed')
    expect(save).toBeEnabled()

    // ...but moving it to another bucket needs one.
    await userEvent.type(screen.getByLabelText(/^Bucket/), '2')
    expect(save).toBeDisabled()
  })
})

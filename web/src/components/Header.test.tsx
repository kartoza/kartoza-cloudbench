import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '../test/test-utils'
import { useTreeStore } from '../stores/treeStore'
import { useUIStore } from '../stores/uiStore'
import Header from './Header'

async function clickMenuItem(text: string) {
  const element = await screen.findByText(text)
  await act(async () => {
    fireEvent.click(element)
  })
}

describe('Header uploads', () => {
  beforeEach(() => {
    useTreeStore.setState({ selectedNode: null })
    useUIStore.getState().closeDialog()
  })

  it('keeps a single Upload Data menu item', async () => {
    render(<Header />)
    await clickMenuItem('Tools')

    expect(await screen.findByText('Upload Data')).toBeInTheDocument()
    expect(screen.queryByText(/Upload File to/)).not.toBeInTheDocument()
  })

  it.each(['s3connection', 's3bucket', 's3folder', 's3object'] as const)(
    'routes Upload Data from a selected %s to S3', async (type) => {
      useTreeStore.setState({
        selectedNode: {
          id: 'selected-s3', name: 'Storage', type,
          s3ConnectionId: 's3-one', s3Bucket: 'uploads',
        },
      })
      render(<Header />)
      await clickMenuItem('Tools')
      await clickMenuItem('Upload Data')

      expect(useUIStore.getState().activeDialog).toBe('s3upload')
      expect(useUIStore.getState().dialogData).toEqual({
        mode: 'create',
        data: { connectionId: 's3-one', bucketName: 'uploads' },
      })
    }
  )

  it('preserves PostgreSQL uploads', async () => {
    useTreeStore.setState({
      selectedNode: {
        id: 'schema', name: 'public', type: 'pgschema',
        serviceName: 'database', schemaName: 'public',
      },
    })
    render(<Header />)
    await clickMenuItem('Tools')
    await clickMenuItem('Upload Data')

    expect(useUIStore.getState().activeDialog).toBe('pgupload')
    expect(useUIStore.getState().dialogData?.data).toEqual({
      serviceName: 'database', schemaName: 'public',
    })
  })

  it('preserves GeoServer uploads', async () => {
    useTreeStore.setState({
      selectedNode: {
        id: 'workspace', name: 'workspace', type: 'workspace', workspace: 'workspace',
      },
    })
    render(<Header />)
    await clickMenuItem('Tools')
    await clickMenuItem('Upload Data')

    expect(useUIStore.getState().activeDialog).toBe('upload')
  })
})

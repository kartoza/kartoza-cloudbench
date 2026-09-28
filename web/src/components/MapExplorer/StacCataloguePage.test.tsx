import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import type { CatalogueConnection } from '../../api/mapExplorer'

const getCatalogue = vi.fn()
const openStyleEditor = vi.fn()
const getS3PresignedUrl = vi.fn()
vi.mock('../../api/mapExplorer', () => ({
  getCatalogue: () => getCatalogue(),
  openStyleEditor: (...args: unknown[]) => openStyleEditor(...args),
  getS3PresignedUrl: (...args: unknown[]) => getS3PresignedUrl(...args),
}))
vi.mock('../../api/connection', () => ({ getConnections: async () => [] }))
vi.mock('../../api/workspace', () => ({ getWorkspaces: async () => [] }))
vi.mock('../../api/layer', () => ({ getLayers: async () => [] }))

import StacCataloguePage from './StacCataloguePage'

function layer(name: string, key: string, format: 'pmtiles' | 'cog') {
  return {
    kind: 'layer' as const,
    name,
    key,
    format,
    folder: key.slice(0, key.lastIndexOf('/')),
    thumbnailKey: null,
    size: 2048,
    updated: '2026-09-28T10:00:00Z',
  }
}

const CATALOGUE: CatalogueConnection[] = [
  {
    connectionId: 'conn',
    connectionName: 'MinIO',
    bucket: 'data',
    fromCatalog: true,
    entries: [
      layer('Roads', 'roads/roads.pmtiles', 'pmtiles'),
      {
        kind: 'group',
        id: 'conn:maps~castelo',
        name: 'Castelo Branco',
        folder: 'maps/castelo',
        sourceName: 'CasteloBranco.gpkg',
        sourceKey: 'maps/castelo/source/CasteloBranco.gpkg',
        itemCount: 2,
        thumbnailKey: null,
        updated: '2026-09-28T10:00:00Z',
        layers: [
          layer('Highway', 'maps/castelo/highway/highway.pmtiles', 'pmtiles'),
          layer('DEM', 'maps/castelo/dem/dem_3857.tif', 'cog'),
        ],
      },
    ],
  },
]

function renderPage() {
  const onOpenOnMap = vi.fn()
  render(
    <ChakraProvider>
      <StacCataloguePage onOpenOnMap={onOpenOnMap} />
    </ChakraProvider>
  )
  return onOpenOnMap
}

describe('StacCataloguePage', () => {
  beforeEach(() => {
    getCatalogue.mockReset().mockResolvedValue(CATALOGUE)
    openStyleEditor.mockReset()
  })

  it('shows a GeoPackage as one card, not its layers', async () => {
    renderPage()

    expect(await screen.findByText('Castelo Branco')).toBeInTheDocument()
    expect(screen.getByText('Roads')).toBeInTheDocument()
    expect(screen.queryByText('Highway')).not.toBeInTheDocument()
    expect(screen.getByText(/2 layers · CasteloBranco\.gpkg/)).toBeInTheDocument()
    expect(screen.getByText('MinIO / data')).toBeInTheDocument()
  })

  it('opens every GeoPackage layer on the map, rasters included', async () => {
    const onOpenOnMap = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Open all on map' }))

    expect(onOpenOnMap).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'maps/castelo/highway/highway.pmtiles', format: 'pmtiles', name: 'Highway' }),
      expect.objectContaining({ key: 'maps/castelo/dem/dem_3857.tif', format: 'cog', name: 'DEM' }),
    ])
  })

  it('browses into a GeoPackage and back with the breadcrumb', async () => {
    const onOpenOnMap = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Browse' }))

    expect(screen.getByText('Highway')).toBeInTheDocument()
    expect(screen.getByText('DEM')).toBeInTheDocument()
    expect(screen.queryByText('Roads')).not.toBeInTheDocument()
    // Only vector layers can have their style edited.
    expect(screen.getAllByText('Edit style')).toHaveLength(1)

    const openButtons = screen.getAllByRole('button', { name: 'Open on map' })
    await userEvent.click(openButtons[1])
    expect(onOpenOnMap).toHaveBeenCalledWith([
      expect.objectContaining({ connectionId: 'conn', bucketName: 'data', key: 'maps/castelo/dem/dem_3857.tif', format: 'cog' }),
    ])

    const breadcrumb = screen.getByRole('navigation', { name: /breadcrumb/i })
    await userEvent.click(within(breadcrumb).getByText('Catalogue'))
    expect(await screen.findByText('Roads')).toBeInTheDocument()
    expect(screen.queryByText('Highway')).not.toBeInTheDocument()
  })

  it('still renders when the catalogue fails to load', async () => {
    getCatalogue.mockRejectedValue(new Error('down'))
    renderPage()
    expect(await screen.findByText(/No datasets found/)).toBeInTheDocument()
  })
})

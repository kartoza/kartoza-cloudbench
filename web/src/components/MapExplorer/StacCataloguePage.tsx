import { useEffect, useState } from 'react'
import {
  Box,
  VStack,
  HStack,
  SimpleGrid,
  Text,
  Spinner,
  Button,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Link as ChakraLink,
  Tooltip,
  Image,
  Center,
} from '@chakra-ui/react'
import {
  getCatalogue,
  getS3PresignedUrl,
  openStyleEditor,
  type CatalogueConnection,
  type CatalogueGroupEntry,
  type CatalogueLayerEntry,
} from '../../api/mapExplorer'
import { getConnections } from '../../api/connection'
import { getWorkspaces } from '../../api/workspace'
import { getLayers } from '../../api/layer'

// A layer "Open on map" shows in Map Explorer (a GeoPackage opens several).
export interface MapTarget {
  connectionId: string
  bucketName: string
  key: string
  format?: 'pmtiles' | 'cog'
  name?: string
}

interface StyleTarget {
  connectionId: string
  key: string
  name: string
}

// A layer's thumbnail.png in its S3 bucket.
interface ThumbnailTarget {
  connectionId: string
  key: string
}

interface CatalogueItem {
  id: string
  title: string
  badge?: string
  description?: string
  // S3 cards show a thumbnail slot (GeoServer layers have no published thumbnail).
  hasThumbnail?: boolean
  thumbnail?: ThumbnailTarget
  // Every layer "Open on map" (or "Open all on map") replaces the map with.
  mapTargets?: MapTarget[]
  styleTarget?: StyleTarget
  onBrowse?: () => void
  downloadHref?: string
  downloadOnClick?: () => void
}

interface CatalogueSection {
  id: string
  title: string
  items: CatalogueItem[]
}

// The GeoPackage being browsed: its layers, under a breadcrumb.
interface BrowsedGroup {
  connection: CatalogueConnection
  group: CatalogueGroupEntry
}

interface StacCataloguePageProps {
  onOpenOnMap: (targets: MapTarget[]) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function describe(parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(' · ')
}

function updatedLabel(updated: string | null | undefined): string | null {
  if (!updated) return null
  const date = new Date(updated)
  return Number.isNaN(date.getTime()) ? null : `Updated ${date.toLocaleDateString()}`
}

function downloadFrom(connectionId: string, key: string) {
  return async () => {
    const url = await getS3PresignedUrl(connectionId, key)
    window.open(url, '_blank')
  }
}

function layerTarget(connection: CatalogueConnection, layer: CatalogueLayerEntry): MapTarget {
  return {
    connectionId: connection.connectionId,
    bucketName: connection.bucket,
    key: layer.key,
    format: layer.format,
    name: layer.name,
  }
}

function layerItem(connection: CatalogueConnection, layer: CatalogueLayerEntry): CatalogueItem {
  const isVector = layer.format === 'pmtiles'
  return {
    id: `s3-${connection.connectionId}-${layer.key}`,
    title: layer.name,
    badge: isVector ? 'Vector' : 'Raster',
    description: describe([layer.size != null && formatBytes(layer.size), updatedLabel(layer.updated)]),
    hasThumbnail: true,
    thumbnail: layer.thumbnailKey ? { connectionId: connection.connectionId, key: layer.thumbnailKey } : undefined,
    mapTargets: [layerTarget(connection, layer)],
    // Maputnik edits vector styles only.
    styleTarget: isVector ? { connectionId: connection.connectionId, key: layer.key, name: layer.name } : undefined,
    downloadOnClick: downloadFrom(connection.connectionId, layer.key),
  }
}

function groupItem(
  connection: CatalogueConnection,
  group: CatalogueGroupEntry,
  onBrowse: (browsed: BrowsedGroup) => void
): CatalogueItem {
  return {
    id: `s3-${connection.connectionId}-group-${group.id}`,
    title: group.name,
    badge: 'GeoPackage',
    description: describe([
      `${group.itemCount} layer${group.itemCount === 1 ? '' : 's'}`,
      group.sourceName,
      updatedLabel(group.updated),
    ]),
    hasThumbnail: true,
    thumbnail: group.thumbnailKey ? { connectionId: connection.connectionId, key: group.thumbnailKey } : undefined,
    mapTargets: group.layers.map((layer) => layerTarget(connection, layer)),
    onBrowse: () => onBrowse({ connection, group }),
    // The original upload, kept as the layers' source asset.
    downloadOnClick: group.sourceKey ? downloadFrom(connection.connectionId, group.sourceKey) : undefined,
  }
}

function connectionTitle(connection: CatalogueConnection): string {
  return `${connection.connectionName} / ${connection.bucket}`
}

function buildS3Sections(
  catalogue: CatalogueConnection[],
  onBrowse: (browsed: BrowsedGroup) => void
): CatalogueSection[] {
  return catalogue.map((connection) => ({
    id: `s3-${connection.connectionId}`,
    title: connectionTitle(connection),
    items: connection.entries.map((entry) =>
      entry.kind === 'group' ? groupItem(connection, entry, onBrowse) : layerItem(connection, entry)
    ),
  }))
}

function wmsPreviewUrl(baseUrl: string, workspace: string, layerName: string): string {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.0',
    request: 'GetMap',
    layers: `${workspace}:${layerName}`,
    bbox: '-180,-90,180,90',
    width: '1024',
    height: '512',
    srs: 'EPSG:4326',
    format: 'image/png',
  })
  return `${baseUrl.replace(/\/$/, '')}/wms?${params}`
}

async function buildGeoServerSections(): Promise<CatalogueSection[]> {
  const connections = await getConnections().catch(() => [])
  const sections: CatalogueSection[] = []

  for (const connection of connections) {
    const workspaces = await getWorkspaces(connection.id).catch(() => [])
    for (const workspace of workspaces) {
      try {
        const layers = await getLayers(connection.id, workspace.name)
        if (layers.length === 0) continue
        sections.push({
          id: `gs-${connection.id}-${workspace.name}`,
          title: `${connection.name} / ${workspace.name}`,
          items: layers.map((layer) => ({
            id: `gs-${connection.id}-${workspace.name}-${layer.name}`,
            title: layer.name,
            description: layer.storeType ? `GeoServer ${layer.storeType}` : 'GeoServer layer',
            downloadHref: wmsPreviewUrl(connection.url, workspace.name, layer.name),
          })),
        })
      } catch {
        // A workspace failing to list shouldn't block the rest of the catalogue.
      }
    }
  }

  return sections
}

const THUMBNAIL_HEIGHT = '140px'

// Presigned rather than proxied: an <img> can't send the API token header.
function CatalogueThumbnail({ target, alt }: { target?: ThumbnailTarget; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!target) return
    let cancelled = false
    getS3PresignedUrl(target.connectionId, target.key)
      .then((presigned) => {
        if (!cancelled) setUrl(presigned)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  if (!target || failed) {
    return (
      <Center h={THUMBNAIL_HEIGHT} bg="gray.50" borderRadius="sm">
        <Text fontSize="xs" color="gray.400">No preview</Text>
      </Center>
    )
  }
  if (!url) {
    return (
      <Center h={THUMBNAIL_HEIGHT} bg="gray.50" borderRadius="sm">
        <Spinner size="sm" color="gray.400" />
      </Center>
    )
  }
  return (
    <Image
      src={url}
      alt={alt}
      h={THUMBNAIL_HEIGHT}
      w="100%"
      objectFit="contain"
      bg="gray.50"
      borderRadius="sm"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function CatalogueCard({ item, onOpenOnMap }: { item: CatalogueItem; onOpenOnMap: (targets: MapTarget[]) => void }) {
  const mapTargets = item.mapTargets ?? []
  const openLabel = item.onBrowse ? 'Open all on map' : 'Open on map'
  return (
    <VStack align="stretch" spacing={2} p={3} borderWidth="1px" borderRadius="md" bg="white">
      {item.hasThumbnail && <CatalogueThumbnail target={item.thumbnail} alt={`${item.title} preview`} />}
      <HStack justify="space-between" align="start">
        <Text fontWeight="semibold" noOfLines={2}>{item.title}</Text>
        {item.badge && (
          <Badge colorScheme={item.badge === 'GeoPackage' ? 'purple' : 'gray'} flexShrink={0}>
            {item.badge}
          </Badge>
        )}
      </HStack>
      {item.description && (
        <Text fontSize="sm" color="gray.600" noOfLines={2}>{item.description}</Text>
      )}
      <HStack justify="space-between" pt={1}>
        <HStack spacing={2}>
          {mapTargets.length > 0 ? (
            <Button size="sm" variant="outline" colorScheme="accent" onClick={() => onOpenOnMap(mapTargets)}>
              {openLabel}
            </Button>
          ) : (
            <Tooltip label="Not yet viewable on the map">
              <Button size="sm" variant="outline" colorScheme="accent" isDisabled>
                {openLabel}
              </Button>
            </Tooltip>
          )}
          {item.onBrowse && (
            <Button size="sm" variant="ghost" onClick={item.onBrowse}>
              Browse
            </Button>
          )}
        </HStack>
        <HStack spacing={3}>
          {item.styleTarget && (
            <ChakraLink
              fontSize="sm"
              color="gray.500"
              onClick={() => {
                const target = item.styleTarget!
                openStyleEditor(target.connectionId, target.key, target.name)
              }}
            >
              Edit style
            </ChakraLink>
          )}
          {item.downloadOnClick ? (
            <ChakraLink fontSize="sm" color="gray.500" onClick={item.downloadOnClick}>
              Download
            </ChakraLink>
          ) : item.downloadHref ? (
            <ChakraLink href={item.downloadHref} isExternal fontSize="sm" color="gray.500">
              Download
            </ChakraLink>
          ) : (
            <Text fontSize="sm" color="gray.300">Download</Text>
          )}
        </HStack>
      </HStack>
    </VStack>
  )
}

function CatalogueGrid({ items, onOpenOnMap }: { items: CatalogueItem[]; onOpenOnMap: (targets: MapTarget[]) => void }) {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
      {items.map((item) => (
        <CatalogueCard key={item.id} item={item} onOpenOnMap={onOpenOnMap} />
      ))}
    </SimpleGrid>
  )
}

export default function StacCataloguePage({ onOpenOnMap }: StacCataloguePageProps) {
  const [catalogue, setCatalogue] = useState<CatalogueConnection[]>([])
  const [geoServerSections, setGeoServerSections] = useState<CatalogueSection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [browsed, setBrowsed] = useState<BrowsedGroup | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const [s3Catalogue, geoServer] = await Promise.all([
        getCatalogue().catch(() => []),
        buildGeoServerSections(),
      ])
      if (cancelled) return
      setCatalogue(s3Catalogue)
      setGeoServerSections(geoServer)
      setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const sections = [...buildS3Sections(catalogue, setBrowsed), ...geoServerSections]

  return (
    <Box h="100%" overflowY="auto" p={6}>
      <VStack align="stretch" spacing={6} maxW="1100px" mx="auto">
        {browsed ? (
          <>
            <Breadcrumb fontSize="sm" color="gray.600">
              <BreadcrumbItem>
                <BreadcrumbLink onClick={() => setBrowsed(null)}>Catalogue</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbItem>
                <BreadcrumbLink onClick={() => setBrowsed(null)}>{connectionTitle(browsed.connection)}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbItem isCurrentPage>
                <Text as="span">{browsed.group.name}</Text>
              </BreadcrumbItem>
            </Breadcrumb>
            <HStack justify="space-between" align="start">
              <Box>
                <HStack>
                  <Text fontSize="2xl" fontWeight="bold">{browsed.group.name}</Text>
                  <Badge colorScheme="purple">GeoPackage</Badge>
                </HStack>
                <Text color="gray.600" mt={1}>
                  {describe([
                    `${browsed.group.itemCount} layer${browsed.group.itemCount === 1 ? '' : 's'}`,
                    `from ${browsed.group.sourceName}`,
                  ])}
                </Text>
              </Box>
              <Button
                size="sm"
                colorScheme="accent"
                onClick={() => onOpenOnMap(browsed.group.layers.map((layer) => layerTarget(browsed.connection, layer)))}
              >
                Open all on map
              </Button>
            </HStack>
            <CatalogueGrid
              items={browsed.group.layers.map((layer) => layerItem(browsed.connection, layer))}
              onOpenOnMap={onOpenOnMap}
            />
          </>
        ) : (
          <>
            <Box>
              <Text fontSize="2xl" fontWeight="bold">CloudBench Catalogue</Text>
              <Text color="gray.600" mt={1}>All datasets available across your connections.</Text>
            </Box>

            {isLoading && (
              <HStack justify="center" py={10}>
                <Spinner />
                <Text color="gray.600">Loading catalogue…</Text>
              </HStack>
            )}

            {!isLoading && sections.length === 0 && (
              <Text color="gray.500">No datasets found. Add an S3 or GeoServer connection first.</Text>
            )}

            {!isLoading &&
              sections.map((section) => (
                <VStack key={section.id} align="stretch" spacing={3}>
                  <HStack>
                    <Text fontWeight="bold" fontSize="lg">{section.title}</Text>
                    <Text color="gray.500">
                      {section.items.length} dataset{section.items.length === 1 ? '' : 's'}
                    </Text>
                  </HStack>
                  <CatalogueGrid items={section.items} onOpenOnMap={onOpenOnMap} />
                </VStack>
              ))}
          </>
        )}
      </VStack>
    </Box>
  )
}

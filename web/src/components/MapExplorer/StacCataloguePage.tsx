import { useEffect, useState } from 'react'
import {
  Box,
  VStack,
  HStack,
  SimpleGrid,
  Text,
  Spinner,
  Button,
  Link as ChakraLink,
  Tooltip,
  Image,
  Center,
} from '@chakra-ui/react'
import { getS3Connections } from '../../api/s3'
import { listPmtilesWithThumbnails, getS3PresignedUrl, openStyleEditor } from '../../api/mapExplorer'
import { getConnections } from '../../api/connection'
import { getWorkspaces } from '../../api/workspace'
import { getLayers } from '../../api/layer'

// The layer "Open on map" shows (on its own) in Map Explorer.
export interface MapTarget {
  connectionId: string
  bucketName: string
  key: string
}

interface StyleTarget {
  connectionId: string
  bucketName: string
  key: string
  name: string
}

// A layer's thumbnail.png in its S3 bucket (see listPmtilesWithThumbnails).
interface ThumbnailTarget {
  connectionId: string
  key: string
}

interface CatalogueItem {
  id: string
  title: string
  description?: string
  thumbnail?: ThumbnailTarget
  mapTarget?: MapTarget
  styleTarget?: StyleTarget
  downloadHref?: string
  downloadOnClick?: () => void
}

interface CatalogueSection {
  id: string
  title: string
  items: CatalogueItem[]
}

interface StacCataloguePageProps {
  onOpenOnMap: (target: MapTarget) => void
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

async function buildS3Sections(): Promise<CatalogueSection[]> {
  const connections = await getS3Connections().catch(() => [])
  const sections: CatalogueSection[] = []

  for (const connection of connections) {
    try {
      const objects = await listPmtilesWithThumbnails(connection.id)
      if (objects.length === 0) continue
      sections.push({
        id: `s3-${connection.id}`,
        title: `${connection.name} / ${connection.bucket}`,
        items: objects.map((obj) => ({
          id: `s3-${connection.id}-${obj.key}`,
          title: obj.key.split('/').pop()?.replace(/\.pmtiles$/i, '') ?? obj.key,
          description: `${formatBytes(obj.size)} · Updated ${new Date(obj.lastModified).toLocaleDateString()}`,
          thumbnail: obj.thumbnailKey ? { connectionId: connection.id, key: obj.thumbnailKey } : undefined,
          mapTarget: { connectionId: connection.id, bucketName: connection.bucket, key: obj.key },
          styleTarget: {
            connectionId: connection.id,
            bucketName: connection.bucket,
            key: obj.key,
            name: obj.key.split('/').pop()?.replace(/\.pmtiles$/i, '') ?? obj.key,
          },
          downloadOnClick: async () => {
            const url = await getS3PresignedUrl(connection.id, obj.key)
            window.open(url, '_blank')
          },
        })),
      })
    } catch {
      // A connection failing to list shouldn't block the rest of the catalogue.
    }
  }

  return sections
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

export default function StacCataloguePage({ onOpenOnMap }: StacCataloguePageProps) {
  const [sections, setSections] = useState<CatalogueSection[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const [s3Sections, geoServerSections] = await Promise.all([
        buildS3Sections(),
        buildGeoServerSections(),
      ])
      if (cancelled) return
      setSections([...s3Sections, ...geoServerSections])
      setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Box h="100%" overflowY="auto" p={6}>
      <VStack align="stretch" spacing={6} maxW="1100px" mx="auto">
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
                <Text color="gray.500">{section.items.length} dataset{section.items.length === 1 ? '' : 's'}</Text>
              </HStack>
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {section.items.map((item) => {
                  const mapTarget = item.mapTarget
                  return (
                    <VStack
                      key={item.id}
                      align="stretch"
                      spacing={2}
                      p={3}
                      borderWidth="1px"
                      borderRadius="md"
                      bg="white"
                    >
                      {/* S3 layers only — GeoServer layers have no published thumbnail. */}
                      {item.id.startsWith('s3-') && (
                        <CatalogueThumbnail target={item.thumbnail} alt={`${item.title} preview`} />
                      )}
                      <Text fontWeight="semibold">{item.title}</Text>
                      {item.description && (
                        <Text fontSize="sm" color="gray.600" noOfLines={2}>{item.description}</Text>
                      )}
                      <HStack justify="space-between" pt={1}>
                        {mapTarget ? (
                          <Button size="sm" variant="outline" colorScheme="accent" onClick={() => onOpenOnMap(mapTarget)}>
                            Open on map
                          </Button>
                        ) : (
                          <Tooltip label="Not yet viewable on the map">
                            <Button size="sm" variant="outline" colorScheme="accent" isDisabled>
                              Open on map
                            </Button>
                          </Tooltip>
                        )}
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
                })}
              </SimpleGrid>
            </VStack>
          ))}
      </VStack>
    </Box>
  )
}

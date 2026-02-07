import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Card,
  Heading,
  Text,
  VStack,
  HStack,
  Badge,
  Spinner,
  IconButton,
  Tooltip,
  useColorModeValue,
  SimpleGrid,
  Collapse,
} from '@chakra-ui/react'
import { FiInfo, FiRefreshCw, FiX } from 'react-icons/fi'

interface MapPreviewProps {
  previewUrl: string | null
  layerName: string
  workspace: string
  storeName?: string
  storeType?: string
  layerType?: string
  onClose?: () => void
}

interface LayerMetadata {
  layer_title?: string
  layer_abstract?: string
  layer_srs?: string
  layer_native_crs?: string
  store_format?: string
  store_enabled?: boolean
  layer_enabled?: boolean
  layer_queryable?: boolean
  layer_advertised?: boolean
  latlon_bbox?: {
    minx: number
    miny: number
    maxx: number
    maxy: number
  }
  errors?: string[]
}

export default function MapPreview({
  previewUrl,
  layerName,
  workspace,
  storeName,
  storeType,
  layerType,
  onClose,
}: MapPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showMetadata, setShowMetadata] = useState(false)
  const [metadata, setMetadata] = useState<LayerMetadata | null>(null)
  const [isLoadingMeta, setIsLoadingMeta] = useState(false)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const metaBg = useColorModeValue('gray.50', 'gray.700')

  useEffect(() => {
    if (previewUrl && showMetadata) {
      setIsLoadingMeta(true)
      fetch(`${previewUrl}/api/metadata`)
        .then((res) => res.json())
        .then((data) => {
          setMetadata(data)
          setIsLoadingMeta(false)
        })
        .catch(() => {
          setIsLoadingMeta(false)
        })
    }
  }, [previewUrl, showMetadata])

  if (!previewUrl) {
    return null
  }

  return (
    <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
      {/* Header */}
      <Box
        bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
        color="white"
        px={4}
        py={3}
      >
        <HStack justify="space-between">
          <VStack align="start" spacing={0}>
            <HStack>
              <Heading size="sm" color="white">
                Layer Preview
              </Heading>
              <Badge colorScheme="whiteAlpha" variant="solid" fontSize="xs">
                {layerType === 'raster' ? 'Raster' : 'Vector'}
              </Badge>
            </HStack>
            <Text fontSize="xs" color="whiteAlpha.800">
              {workspace}:{layerName}
            </Text>
          </VStack>
          <HStack spacing={1}>
            <Tooltip label="Refresh">
              <IconButton
                aria-label="Refresh"
                icon={<FiRefreshCw />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={() => iframeRef.current?.contentWindow?.location.reload()}
              />
            </Tooltip>
            <Tooltip label="Layer Info">
              <IconButton
                aria-label="Layer Info"
                icon={<FiInfo />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={() => setShowMetadata(!showMetadata)}
                bg={showMetadata ? 'whiteAlpha.200' : undefined}
              />
            </Tooltip>
            {onClose && (
              <Tooltip label="Close Preview">
                <IconButton
                  aria-label="Close"
                  icon={<FiX />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={onClose}
                />
              </Tooltip>
            )}
          </HStack>
        </HStack>
      </Box>

      {/* Metadata Panel */}
      <Collapse in={showMetadata} animateOpacity>
        <Box bg={metaBg} p={4} borderBottom="1px solid" borderColor={borderColor}>
          {isLoadingMeta ? (
            <HStack justify="center" py={4}>
              <Spinner size="sm" color="kartoza.500" />
              <Text fontSize="sm" color="gray.500">Loading metadata...</Text>
            </HStack>
          ) : metadata ? (
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
              {metadata.layer_title && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">Title</Text>
                  <Text fontSize="sm">{metadata.layer_title}</Text>
                </Box>
              )}
              {metadata.layer_srs && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">SRS</Text>
                  <Text fontSize="sm" fontFamily="mono">{metadata.layer_srs}</Text>
                </Box>
              )}
              {metadata.store_format && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">Format</Text>
                  <Text fontSize="sm">{metadata.store_format}</Text>
                </Box>
              )}
              {metadata.latlon_bbox && (
                <Box gridColumn={{ md: 'span 2', lg: 'span 3' }}>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">Bounding Box (WGS84)</Text>
                  <Text fontSize="sm" fontFamily="mono">
                    [{metadata.latlon_bbox.minx.toFixed(4)}, {metadata.latlon_bbox.miny.toFixed(4)}] -
                    [{metadata.latlon_bbox.maxx.toFixed(4)}, {metadata.latlon_bbox.maxy.toFixed(4)}]
                  </Text>
                </Box>
              )}
              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="500">Status</Text>
                <HStack spacing={2} mt={1}>
                  {metadata.layer_enabled !== undefined && (
                    <Badge colorScheme={metadata.layer_enabled ? 'green' : 'gray'} size="sm">
                      {metadata.layer_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  )}
                  {metadata.layer_queryable !== undefined && metadata.layer_queryable && (
                    <Badge colorScheme="blue" size="sm">Queryable</Badge>
                  )}
                  {metadata.layer_advertised !== undefined && metadata.layer_advertised && (
                    <Badge colorScheme="purple" size="sm">Advertised</Badge>
                  )}
                </HStack>
              </Box>
              {metadata.layer_abstract && (
                <Box gridColumn={{ md: 'span 2', lg: 'span 3' }}>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">Abstract</Text>
                  <Text fontSize="sm" noOfLines={3}>{metadata.layer_abstract}</Text>
                </Box>
              )}
            </SimpleGrid>
          ) : (
            <Text fontSize="sm" color="gray.500">No metadata available</Text>
          )}
        </Box>
      </Collapse>

      {/* Map - fills remaining space */}
      <Box
        flex="1"
        minH="300px"
        position="relative"
        bg="gray.100"
      >
        <iframe
          ref={iframeRef}
          src={previewUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title={`Preview of ${workspace}:${layerName}`}
        />
      </Box>

      {/* Footer */}
      <Box px={4} py={2} bg={metaBg} borderTop="1px solid" borderColor={borderColor}>
        <HStack justify="space-between" fontSize="xs" color="gray.500">
          <Text>
            Store: {storeName || 'N/A'} ({storeType || 'unknown'})
          </Text>
          <HStack spacing={4}>
            <Text>Zoom with scroll, drag to pan</Text>
          </HStack>
        </HStack>
      </Box>
    </Card>
  )
}

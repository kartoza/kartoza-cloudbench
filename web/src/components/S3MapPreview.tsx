import { useEffect, useRef, useState } from 'react'
import { Box, Card, CardBody, Flex, HStack, Heading, IconButton, Text, Tooltip, Spinner, Center, useColorModeValue } from '@chakra-ui/react'
import { FiX, FiMaximize2 } from 'react-icons/fi'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { cogProtocol } from '@geomatico/maplibre-cog-protocol'
import { getPmtilesStyle } from '../api/mapExplorer'
import { useUIStore } from '../stores/uiStore'
import { loadLayerOntoMap, applyPmtilesVectorStyle, layerIdFor } from './MapExplorer/layerLoader'

const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const LAYER_COLOR = '#54A2CC'

interface S3MapPreviewProps {
  connectionId: string
  bucketName: string
  objectKey: string
  format: 'pmtiles' | 'cog'
  onClose?: () => void
}

export default function S3MapPreview({ connectionId, bucketName, objectKey, format, onClose }: S3MapPreviewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cardBg = useColorModeValue('white', 'gray.800')
  const requestOpenMapExplorer = useUIStore((state) => state.requestOpenMapExplorer)

  const fileName = objectKey.split('/').filter(Boolean).pop() || objectKey

  useEffect(() => {
    if (!mapContainer.current) return
    setIsLoading(true)
    setError(null)

    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)
    maplibregl.addProtocol('cog', cogProtocol)

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: BASEMAP_STYLE_URL,
      center: [0, 0],
      zoom: 1,
    })
    map.current = mapInstance

    const layerId = layerIdFor({ connectionId, bucketName, key: objectKey, format })

    mapInstance.on('load', () => {
      loadLayerOntoMap(mapInstance, protocol, connectionId, {
        id: layerId,
        key: objectKey,
        format,
        color: LAYER_COLOR,
        opacity: 100,
      })
        .then(({ bounds, isVector, sourceLayer }) => {
          mapInstance.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            { padding: 40, maxZoom: 16, animate: false }
          )
          setIsLoading(false)

          if (!isVector) return
          getPmtilesStyle(connectionId, objectKey).then((style) => {
            if (!style) return
            applyPmtilesVectorStyle(mapInstance, layerId, sourceLayer ?? 'default', LAYER_COLOR, 100, style)
          })
        })
        .catch((err) => {
          setError((err as Error).message || 'Failed to load layer')
          setIsLoading(false)
        })
    })

    return () => {
      mapInstance.remove()
      map.current = null
      maplibregl.removeProtocol('pmtiles')
      maplibregl.removeProtocol('cog')
    }
  }, [connectionId, bucketName, objectKey, format])

  return (
    <Card bg={cardBg} flex="1" display="flex" flexDirection="column" minH="0">
      <CardBody display="flex" flexDirection="column" minH="0" p={0}>
        <Flex align="center" justify="space-between" p={4} borderBottomWidth="1px">
          <HStack spacing={3} minW={0}>
            <Heading size="sm" noOfLines={1}>{fileName}</Heading>
            <Text fontSize="xs" color="gray.500" textTransform="uppercase">{format}</Text>
          </HStack>
          <HStack spacing={1}>
            <Tooltip label="Open in Map Explorer" fontSize="xs">
              <IconButton
                aria-label="Open in Map Explorer"
                icon={<FiMaximize2 size={14} />}
                size="sm"
                variant="ghost"
                onClick={() => requestOpenMapExplorer({ connectionId, bucketName, key: objectKey })}
              />
            </Tooltip>
            {onClose && (
              <Tooltip label="Close" fontSize="xs">
                <IconButton aria-label="Close" icon={<FiX size={16} />} size="sm" variant="ghost" onClick={onClose} />
              </Tooltip>
            )}
          </HStack>
        </Flex>
        <Box position="relative" flex="1" minH="400px">
          <Box ref={mapContainer} position="absolute" inset={0} />
          {isLoading && (
            <Center position="absolute" inset={0} bg="blackAlpha.50">
              <Spinner color="kartoza.500" />
            </Center>
          )}
          {error && (
            <Center position="absolute" inset={0} bg="blackAlpha.50">
              <Text color="red.500" fontWeight="medium" bg="white" px={4} py={2} borderRadius="md" shadow="md">
                {error}
              </Text>
            </Center>
          )}
        </Box>
      </CardBody>
    </Card>
  )
}

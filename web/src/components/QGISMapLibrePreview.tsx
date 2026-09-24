import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Text,
  VStack,
  HStack,
  Icon,
  Spinner,
  Badge,
  Alert,
  AlertIcon,
  AlertDescription,
  IconButton,
  Tooltip,
  useColorModeValue,
  Collapse,
  List,
  ListItem,
  ListIcon,
  Switch,
  Divider,
} from '@chakra-ui/react'
import {
  FiZoomIn,
  FiZoomOut,
  FiMaximize2,
  FiLayers,
  FiX,
  FiEyeOff,
  FiMap,
  FiImage,
  FiDatabase,
  FiGlobe,
} from 'react-icons/fi'
import { SiQgis } from 'react-icons/si'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as api from '../api'
import type { QGISProjectMetadata, QGISLayer } from '../api'

interface QGISMapLibrePreviewProps {
  projectId: string
  projectName?: string
  onClose?: () => void
}

export default function QGISMapLibrePreview({
  projectId,
  projectName,
  onClose,
}: QGISMapLibrePreviewProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<QGISProjectMetadata | null>(null)
  const [showLayers, setShowLayers] = useState(true)
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({})

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const layerBg = useColorModeValue('gray.50', 'gray.700')
  const layerHoverBg = useColorModeValue('gray.100', 'gray.600')

  // Load project metadata
  useEffect(() => {
    const loadMetadata = async () => {
      if (!projectId) return

      setIsLoading(true)
      setError(null)

      try {
        const data = await api.getQGISProjectMetadata(projectId)
        setMetadata(data)

        // Initialize layer visibility from project
        const visibility: Record<string, boolean> = {}
        data.layers.forEach(layer => {
          visibility[layer.id] = layer.visible
        })
        setLayerVisibility(visibility)
      } catch (err) {
        console.error('Failed to load project metadata:', err)
        setError((err as Error).message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMetadata()
  }, [projectId])

  // Initialize map when metadata is loaded
  useEffect(() => {
    if (!metadata || !mapContainerRef.current || mapRef.current) return

    // Find XYZ layers to add to the map
    const xyzLayers = metadata.layers.filter(l => l.type === 'xyz' && l.tileUrl)

    if (xyzLayers.length === 0) {
      // No XYZ layers, show a message
      return
    }

    // Create map with first XYZ layer as base
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [],
      },
      center: [0, 0],
      zoom: 2,
    })

    map.on('load', () => {
      // Add XYZ layers
      xyzLayers.forEach((layer, index) => {
        if (!layer.tileUrl) return

        const sourceId = `qgis-source-${index}`
        const layerId = `qgis-layer-${index}`

        map.addSource(sourceId, {
          type: 'raster',
          tiles: [layer.tileUrl],
          tileSize: 256,
          attribution: layer.name,
        })

        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          layout: {
            visibility: layerVisibility[layer.id] !== false ? 'visible' : 'none',
          },
        })
      })

      // Fit to extent if available
      if (metadata.extent) {
        const { xMin, yMin, xMax, yMax } = metadata.extent
        // Check if extent is in Web Mercator (EPSG:3857)
        if (metadata.crs === 'EPSG:3857') {
          // Convert from Web Mercator to WGS84
          const merc2lng = (x: number) => (x / 20037508.34) * 180
          const merc2lat = (y: number) => {
            const lat = (y / 20037508.34) * 180
            return 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2)
          }
          map.fitBounds([
            [merc2lng(xMin), merc2lat(yMin)],
            [merc2lng(xMax), merc2lat(yMax)],
          ], { padding: 50 })
        } else if (metadata.crs === 'EPSG:4326') {
          map.fitBounds([
            [xMin, yMin],
            [xMax, yMax],
          ], { padding: 50 })
        }
      }

      // Add navigation controls
      map.addControl(new maplibregl.NavigationControl(), 'top-right')
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [metadata]) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle layer visibility
  const toggleLayerVisibility = useCallback((layerId: string, index: number) => {
    const map = mapRef.current
    if (!map) return

    const newVisibility = !layerVisibility[layerId]
    setLayerVisibility(prev => ({ ...prev, [layerId]: newVisibility }))

    const mapLayerId = `qgis-layer-${index}`
    if (map.getLayer(mapLayerId)) {
      map.setLayoutProperty(
        mapLayerId,
        'visibility',
        newVisibility ? 'visible' : 'none'
      )
    }
  }, [layerVisibility])

  // Zoom controls
  const handleZoomIn = () => mapRef.current?.zoomIn()
  const handleZoomOut = () => mapRef.current?.zoomOut()
  const handleResetView = () => {
    if (!mapRef.current || !metadata?.extent) return
    const { xMin, yMin, xMax, yMax } = metadata.extent
    if (metadata.crs === 'EPSG:3857') {
      const merc2lng = (x: number) => (x / 20037508.34) * 180
      const merc2lat = (y: number) => {
        const lat = (y / 20037508.34) * 180
        return 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2)
      }
      mapRef.current.fitBounds([
        [merc2lng(xMin), merc2lat(yMin)],
        [merc2lng(xMax), merc2lat(yMax)],
      ], { padding: 50 })
    } else if (metadata.crs === 'EPSG:4326') {
      mapRef.current.fitBounds([
        [xMin, yMin],
        [xMax, yMax],
      ], { padding: 50 })
    }
  }

  // Get icon for layer type
  const getLayerIcon = (layer: QGISLayer) => {
    if (layer.type === 'xyz') return FiGlobe
    if (layer.type === 'wms') return FiGlobe
    if (layer.type === 'raster') return FiImage
    if (layer.type === 'vector') return FiDatabase
    return FiMap
  }

  // Check if we have renderable layers
  const hasRenderableLayers = metadata?.layers.some(l => l.type === 'xyz' && l.tileUrl)

  return (
    <Box
      bg={cardBg}
      borderRadius="xl"
      overflow="hidden"
      border="1px solid"
      borderColor={borderColor}
      h="100%"
      display="flex"
      flexDirection="column"
    >
      {/* Header */}
      <Box
        bg="surface.header"
        px={4}
        py={3}
      >
        <HStack spacing={3} justify="space-between">
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={SiQgis} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="md" noOfLines={1}>
                {metadata?.title || projectName || 'QGIS Project'}
              </Text>
              {metadata?.crs && (
                <Badge bg="whiteAlpha.200" color="white" fontSize="xs">
                  {metadata.crs}
                </Badge>
              )}
            </Box>
          </HStack>

          {/* Toolbar */}
          <HStack spacing={1}>
            <Tooltip label="Toggle Layers">
              <IconButton
                aria-label="Toggle layers"
                icon={<FiLayers />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={() => setShowLayers(!showLayers)}
              />
            </Tooltip>
            <Tooltip label="Zoom In">
              <IconButton
                aria-label="Zoom in"
                icon={<FiZoomIn />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleZoomIn}
              />
            </Tooltip>
            <Tooltip label="Zoom Out">
              <IconButton
                aria-label="Zoom out"
                icon={<FiZoomOut />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleZoomOut}
              />
            </Tooltip>
            <Tooltip label="Reset View">
              <IconButton
                aria-label="Reset view"
                icon={<FiMaximize2 />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleResetView}
              />
            </Tooltip>
            {onClose && (
              <Tooltip label="Close">
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

      {/* Content */}
      <Box flex="1" position="relative" display="flex">
        {/* Layer Panel */}
        <Collapse in={showLayers} animateOpacity>
          <Box
            w="250px"
            h="100%"
            bg={layerBg}
            borderRight="1px solid"
            borderColor={borderColor}
            overflow="auto"
            p={3}
          >
            <Text fontWeight="600" fontSize="sm" mb={2}>
              Layers ({metadata?.layers.length || 0})
            </Text>
            <Divider mb={2} />
            <List spacing={1}>
              {metadata?.layers.map((layer, index) => (
                <ListItem
                  key={layer.id}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  py={1}
                  px={2}
                  borderRadius="md"
                  _hover={{ bg: layerHoverBg }}
                >
                  <HStack spacing={2} flex="1" minW={0}>
                    <ListIcon as={getLayerIcon(layer)} color="green.500" />
                    <Text fontSize="sm" noOfLines={1} title={layer.name}>
                      {layer.name}
                    </Text>
                  </HStack>
                  {layer.type === 'xyz' && layer.tileUrl && (
                    <Switch
                      size="sm"
                      isChecked={layerVisibility[layer.id] !== false}
                      onChange={() => toggleLayerVisibility(layer.id, index)}
                    />
                  )}
                  {layer.type !== 'xyz' && (
                    <Tooltip label={`${layer.type} layers cannot be rendered in MapLibre`}>
                      <Icon as={FiEyeOff} color="gray.400" />
                    </Tooltip>
                  )}
                </ListItem>
              ))}
            </List>

            {metadata && (
              <>
                <Divider my={3} />
                <Text fontWeight="600" fontSize="sm" mb={2}>
                  Project Info
                </Text>
                <VStack align="start" spacing={1} fontSize="xs" color="gray.500">
                  <Text>Version: {metadata.version}</Text>
                  {metadata.saveUser && <Text>Author: {metadata.saveUser}</Text>}
                  {metadata.saveDate && (
                    <Text>Saved: {new Date(metadata.saveDate).toLocaleDateString()}</Text>
                  )}
                </VStack>
              </>
            )}
          </Box>
        </Collapse>

        {/* Map Container */}
        <Box flex="1" position="relative">
          {isLoading && (
            <VStack
              position="absolute"
              top="50%"
              left="50%"
              transform="translate(-50%, -50%)"
              spacing={4}
              zIndex={10}
            >
              <Spinner size="xl" color="green.400" thickness="4px" />
              <Text fontWeight="500">Loading project...</Text>
            </VStack>
          )}

          {error && (
            <Alert
              status="error"
              position="absolute"
              top="50%"
              left="50%"
              transform="translate(-50%, -50%)"
              maxW="md"
              borderRadius="lg"
            >
              <AlertIcon />
              <AlertDescription>
                <VStack align="start" spacing={2}>
                  <Text fontWeight="600">Failed to load project</Text>
                  <Text fontSize="sm">{error}</Text>
                </VStack>
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && !hasRenderableLayers && (
            <Alert
              status="info"
              position="absolute"
              top="50%"
              left="50%"
              transform="translate(-50%, -50%)"
              maxW="md"
              borderRadius="lg"
            >
              <AlertIcon />
              <AlertDescription>
                <VStack align="start" spacing={2}>
                  <Text fontWeight="600">No renderable layers</Text>
                  <Text fontSize="sm">
                    This project contains {metadata?.layers.length || 0} layers, but none are XYZ tile layers that can be displayed in the web preview.
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    Supported: XYZ/TMS tile layers. Not supported: Local raster/vector files, WMS (coming soon).
                  </Text>
                </VStack>
              </AlertDescription>
            </Alert>
          )}

          <Box
            ref={mapContainerRef}
            w="100%"
            h="100%"
            minH="400px"
            display={hasRenderableLayers ? 'block' : 'none'}
          />
        </Box>
      </Box>
    </Box>
  )
}

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
  ButtonGroup,
  Button,
  Icon,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Divider,
} from '@chakra-ui/react'
import { FiInfo, FiRefreshCw, FiX, FiDroplet, FiBox, FiGlobe, FiMap, FiChevronDown } from 'react-icons/fi'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as api from '../api/client'
import { useUIStore } from '../stores/uiStore'

interface MapPreviewProps {
  previewUrl: string | null
  layerName: string
  workspace: string
  storeName?: string
  storeType?: string
  layerType?: string
  connectionId?: string
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

interface LayerInfo {
  name: string
  workspace: string
  store_name: string
  store_type: string
  geoserver_url: string
  type: string
  use_cache: boolean
  grid_set?: string
  tile_format?: string
}

type ViewMode = '2d' | '3d'

// Component to display a style legend icon using GeoServer's GetLegendGraphic
function StyleLegendIcon({
  geoserverUrl,
  workspace,
  layerName,
  styleName,
  size = 20
}: {
  geoserverUrl: string
  workspace: string
  layerName: string
  styleName: string
  size?: number
}) {
  const [hasError, setHasError] = useState(false)
  const legendUrl = `${geoserverUrl}/${workspace}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&LAYER=${workspace}:${layerName}&STYLE=${styleName}&FORMAT=image/png&WIDTH=${size}&HEIGHT=${size}&LEGEND_OPTIONS=forceLabels:off;fontAntiAliasing:true`

  if (hasError) {
    return <Icon as={FiDroplet} color="pink.500" boxSize={`${size}px`} />
  }

  return (
    <Box
      as="img"
      src={legendUrl}
      alt={styleName}
      w={`${size}px`}
      h={`${size}px`}
      minW={`${size}px`}
      minH={`${size}px`}
      borderRadius="sm"
      objectFit="contain"
      bg="white"
      border="1px solid"
      borderColor="gray.200"
      onError={() => setHasError(true)}
    />
  )
}

export default function MapPreview({
  previewUrl,
  layerName,
  workspace,
  storeName,
  storeType,
  layerType,
  connectionId,
  onClose,
}: MapPreviewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const lastBoundsRef = useRef<[number, number, number, number] | null>(null)
  const [showMetadata, setShowMetadata] = useState(false)
  const [metadata, setMetadata] = useState<LayerMetadata | null>(null)
  const [layerInfo, setLayerInfo] = useState<LayerInfo | null>(null)
  const [isLoadingMeta, setIsLoadingMeta] = useState(false)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('2d')

  // Style management
  const [availableStyles, setAvailableStyles] = useState<string[]>([])
  const [currentStyle, setCurrentStyle] = useState<string>('')
  const [defaultStyle, setDefaultStyle] = useState<string>('')

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const metaBg = useColorModeValue('gray.50', 'gray.700')

  // Store for switching to 3D Globe preview
  const setPreviewMode = useUIStore((state) => state.setPreviewMode)

  // Fetch layer info from preview server (includes geoserver_url)
  useEffect(() => {
    if (previewUrl) {
      console.log('[MapPreview] Fetching layer info from:', `${previewUrl}/api/layer`)
      fetch(`${previewUrl}/api/layer`)
        .then((res) => res.json())
        .then((data: LayerInfo) => {
          console.log('[MapPreview] Received layer info:', data)
          setLayerInfo(data)
        })
        .catch((err) => {
          console.error('[MapPreview] Failed to fetch layer info:', err)
        })
    }
  }, [previewUrl])

  // Fetch metadata immediately (not just when panel is shown)
  useEffect(() => {
    if (previewUrl) {
      console.log('[MapPreview] Fetching metadata from:', `${previewUrl}/api/metadata`)
      setIsLoadingMeta(true)
      fetch(`${previewUrl}/api/metadata`)
        .then((res) => res.json())
        .then((data) => {
          console.log('[MapPreview] Received metadata:', data)
          setMetadata(data)
          setIsLoadingMeta(false)
        })
        .catch((err) => {
          console.error('[MapPreview] Failed to fetch metadata:', err)
          setIsLoadingMeta(false)
        })
    }
  }, [previewUrl])

  // Fetch available styles for the layer
  useEffect(() => {
    if (connectionId && workspace && layerName) {
      api.getLayerStyles(connectionId, workspace, layerName)
        .then((styles) => {
          const allStyles = [styles.defaultStyle, ...(styles.additionalStyles || [])]
          setAvailableStyles(allStyles.filter(Boolean))
          setDefaultStyle(styles.defaultStyle || '')
          setCurrentStyle(styles.defaultStyle || '')
        })
        .catch((err) => {
          console.error('Failed to fetch layer styles:', err)
        })
    }
  }, [connectionId, workspace, layerName])

  // Check if two bounding boxes overlap
  const boundsOverlap = (
    a: [number, number, number, number],
    b: [number, number, number, number]
  ): boolean => {
    // Bounds format: [minX, minY, maxX, maxY]
    return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1])
  }

  // Check if current map view intersects with bounds
  const currentViewOverlapsBounds = (
    bounds: [number, number, number, number]
  ): boolean => {
    if (!map.current) return false
    const mapBounds = map.current.getBounds()
    const currentBounds: [number, number, number, number] = [
      mapBounds.getWest(),
      mapBounds.getSouth(),
      mapBounds.getEast(),
      mapBounds.getNorth(),
    ]
    return boundsOverlap(currentBounds, bounds)
  }

  // Build WMS tile URL with current style - not a callback since we use it in effects
  const buildWmsTileUrl = (info: LayerInfo, style?: string): string => {
    const layerFullName = `${info.workspace}:${info.name}`

    // Check if we should use WMTS (cached tiles)
    if (info.use_cache) {
      const gridSet = info.grid_set || 'EPSG:900913'
      const tileFormat = info.tile_format || 'image/png'
      // GeoServer WMTS REST URL pattern
      return `${info.geoserver_url}/gwc/service/wmts/rest/${encodeURIComponent(layerFullName)}/${gridSet}/${encodeURIComponent(tileFormat)}/{z}/{y}/{x}`
    }

    // Use WMS (uncached) - construct URL using actual GeoServer URL
    const wmsUrl = `${info.geoserver_url}/${info.workspace}/wms`

    // Build WMS tile URL for MapLibre
    // Note: We can't use URLSearchParams for the full URL because it encodes
    // the {bbox-epsg-3857} placeholder which MapLibre needs unencoded
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      LAYERS: layerFullName,
      FORMAT: 'image/png',
      TRANSPARENT: 'true',
      SRS: 'EPSG:3857',
      WIDTH: '256',
      HEIGHT: '256',
    })

    if (style) {
      params.set('STYLES', style)
    }

    // Append BBOX with the unencoded MapLibre placeholder
    return `${wmsUrl}?${params.toString()}&BBOX={bbox-epsg-3857}`
  }

  // Initialize map - only depends on layerInfo, creates map once
  useEffect(() => {
    if (!mapContainer.current || !layerInfo) return

    // Get initial bounds from metadata or use world bounds
    const bounds: [number, number, number, number] = metadata?.latlon_bbox
      ? [metadata.latlon_bbox.minx, metadata.latlon_bbox.miny, metadata.latlon_bbox.maxx, metadata.latlon_bbox.maxy]
      : [-180, -85, 180, 85]

    const center: [number, number] = [
      (bounds[0] + bounds[2]) / 2,
      (bounds[1] + bounds[3]) / 2,
    ]

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: [
              'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center,
      zoom: 2,
    })

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left')

    map.current.on('load', () => {
      setMapLoaded(true)
    })

    return () => {
      if (map.current) {
        map.current.remove()
        map.current = null
        setMapLoaded(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerInfo]) // Only recreate map when layerInfo changes

  // Add/update WMS layer when map is loaded or style changes
  useEffect(() => {
    if (!map.current || !mapLoaded || !layerInfo) return

    const wmsTileUrl = buildWmsTileUrl(layerInfo, currentStyle)

    // Log the WMS URL for debugging
    console.log('[MapPreview] Layer info:', {
      workspace: layerInfo.workspace,
      name: layerInfo.name,
      geoserver_url: layerInfo.geoserver_url,
      store_type: layerInfo.store_type,
      type: layerInfo.type,
      use_cache: layerInfo.use_cache,
    })
    console.log('[MapPreview] WMS tile URL template:', wmsTileUrl)
    console.log('[MapPreview] Current style:', currentStyle || '(default)')

    // Remove existing layer and source if they exist
    if (map.current.getLayer('wms-layer')) {
      map.current.removeLayer('wms-layer')
    }
    if (map.current.getSource('wms-layer')) {
      map.current.removeSource('wms-layer')
    }

    // Add new source and layer
    map.current.addSource('wms-layer', {
      type: 'raster',
      tiles: [wmsTileUrl],
      tileSize: 256,
    })

    map.current.addLayer({
      id: 'wms-layer',
      type: 'raster',
      source: 'wms-layer',
      paint: {
        'raster-opacity': 1,
      },
    })

    // Handle bounds - only fit to new bounds if current view doesn't overlap
    if (metadata?.latlon_bbox) {
      const newBounds: [number, number, number, number] = [
        metadata.latlon_bbox.minx,
        metadata.latlon_bbox.miny,
        metadata.latlon_bbox.maxx,
        metadata.latlon_bbox.maxy,
      ]

      console.log('[MapPreview] Layer bounds (lat/lon):', newBounds)

      // Check if current view overlaps with new layer bounds
      // If they overlap, keep the current view; otherwise, fit to new bounds
      const shouldFitBounds = !currentViewOverlapsBounds(newBounds)

      console.log('[MapPreview] Should fit to bounds:', shouldFitBounds)

      if (shouldFitBounds) {
        map.current.fitBounds(newBounds, { padding: 50, maxZoom: 15 })
      }

      // Store the new bounds for future reference
      lastBoundsRef.current = newBounds
    } else {
      console.log('[MapPreview] No bounds available in metadata')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, layerInfo, currentStyle, metadata?.latlon_bbox])

  // Update view mode (2D/3D/Globe)
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    switch (viewMode) {
      case '2d':
        map.current.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 500,
        })
        map.current.setMaxPitch(0)
        break
      case '3d':
        map.current.setMaxPitch(85)
        map.current.easeTo({
          pitch: 45,
          duration: 500,
        })
        break
    }
  }, [viewMode, mapLoaded])

  const handleRefresh = () => {
    if (!map.current || !mapLoaded || !layerInfo) return

    // Force reload by removing and re-adding the layer
    const wmsTileUrl = buildWmsTileUrl(layerInfo, currentStyle)

    if (map.current.getLayer('wms-layer')) {
      map.current.removeLayer('wms-layer')
    }
    if (map.current.getSource('wms-layer')) {
      map.current.removeSource('wms-layer')
    }

    // Add with cache buster
    const cacheBuster = `&_t=${Date.now()}`
    map.current.addSource('wms-layer', {
      type: 'raster',
      tiles: [wmsTileUrl + cacheBuster],
      tileSize: 256,
    })

    map.current.addLayer({
      id: 'wms-layer',
      type: 'raster',
      source: 'wms-layer',
      paint: {
        'raster-opacity': 1,
      },
    })
  }

  const handleStyleChange = (style: string) => {
    setCurrentStyle(style)
  }

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
          <HStack spacing={2}>
            {/* Style Picker Dropdown */}
            {availableStyles.length > 0 && (
              <Menu>
                <MenuButton
                  as={Button}
                  size="sm"
                  variant="solid"
                  bg="whiteAlpha.200"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.300' }}
                  _active={{ bg: 'whiteAlpha.400' }}
                  rightIcon={<FiChevronDown />}
                  leftIcon={<FiDroplet />}
                  maxW="180px"
                >
                  <Text isTruncated fontSize="xs">
                    {currentStyle || 'Default Style'}
                  </Text>
                </MenuButton>
                <MenuList color="gray.800" zIndex={1000}>
                  {availableStyles.map((style) => (
                    <MenuItem
                      key={style}
                      onClick={() => handleStyleChange(style)}
                      fontWeight={currentStyle === style ? 'bold' : 'normal'}
                      bg={currentStyle === style ? 'kartoza.50' : undefined}
                    >
                      <HStack>
                        {layerInfo?.geoserver_url ? (
                          <StyleLegendIcon
                            geoserverUrl={layerInfo.geoserver_url}
                            workspace={workspace}
                            layerName={layerName}
                            styleName={style}
                            size={20}
                          />
                        ) : (
                          <Icon as={FiDroplet} color="pink.500" />
                        )}
                        <Text>{style}</Text>
                        {style === defaultStyle && (
                          <Badge colorScheme="kartoza" size="sm" ml={2}>Default</Badge>
                        )}
                      </HStack>
                    </MenuItem>
                  ))}
                </MenuList>
              </Menu>
            )}

            {/* View Mode Toggle */}
            <ButtonGroup size="sm" isAttached variant="ghost">
              <Tooltip label="2D View">
                <IconButton
                  aria-label="2D"
                  icon={<FiMap />}
                  color="white"
                  bg={viewMode === '2d' ? 'whiteAlpha.300' : undefined}
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={() => setViewMode('2d')}
                />
              </Tooltip>
              <Tooltip label="3D View (tilt)">
                <IconButton
                  aria-label="3D"
                  icon={<FiBox />}
                  color="white"
                  bg={viewMode === '3d' ? 'whiteAlpha.300' : undefined}
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={() => setViewMode('3d')}
                />
              </Tooltip>
            </ButtonGroup>

            {/* 3D Globe (Cesium) Toggle */}
            <Tooltip label="3D Globe (Cesium)">
              <IconButton
                aria-label="3D Globe"
                icon={<FiGlobe />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={() => setPreviewMode('3d')}
              />
            </Tooltip>

            <Divider orientation="vertical" h="24px" borderColor="whiteAlpha.400" />

            <Tooltip label="Refresh">
              <IconButton
                aria-label="Refresh"
                icon={<FiRefreshCw />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleRefresh}
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

      {/* Current Style Indicator */}
      {currentStyle && availableStyles.length > 1 && (
        <Box px={4} py={2} bg="kartoza.50" borderBottom="1px solid" borderColor={borderColor}>
          <HStack fontSize="sm">
            <Icon as={FiDroplet} color="pink.500" />
            <Text color="gray.600">
              Style: <Text as="span" fontWeight="600">{currentStyle}</Text>
              {currentStyle === defaultStyle && (
                <Badge ml={2} colorScheme="kartoza" size="sm">Default</Badge>
              )}
            </Text>
            {availableStyles.length > 1 && (
              <Menu>
                <MenuButton
                  as={Button}
                  size="xs"
                  variant="ghost"
                  rightIcon={<FiChevronDown />}
                  ml="auto"
                >
                  Change
                </MenuButton>
                <MenuList>
                  {availableStyles.map((style) => (
                    <MenuItem
                      key={style}
                      onClick={() => handleStyleChange(style)}
                      fontWeight={currentStyle === style ? 'bold' : 'normal'}
                    >
                      <HStack>
                        <Icon as={FiDroplet} color="pink.500" />
                        <Text>{style}</Text>
                        {style === defaultStyle && (
                          <Badge colorScheme="kartoza" size="sm">Default</Badge>
                        )}
                      </HStack>
                    </MenuItem>
                  ))}
                </MenuList>
              </Menu>
            )}
          </HStack>
        </Box>
      )}

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

      {/* Map Container */}
      <Box
        flex="1"
        minH="300px"
        position="relative"
        bg="gray.100"
      >
        <Box
          ref={mapContainer}
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
        />
        {!mapLoaded && (
          <Box
            position="absolute"
            top="50%"
            left="50%"
            transform="translate(-50%, -50%)"
            textAlign="center"
          >
            <Spinner size="xl" color="kartoza.500" />
            <Text mt={2} color="gray.600">Loading map...</Text>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box px={4} py={2} bg={metaBg} borderTop="1px solid" borderColor={borderColor}>
        <HStack justify="space-between" fontSize="xs" color="gray.500">
          <Text>
            Store: {storeName || 'N/A'} ({storeType || 'unknown'})
          </Text>
          <HStack spacing={4}>
            <Badge colorScheme={viewMode === '2d' ? 'blue' : viewMode === '3d' ? 'purple' : 'green'}>
              {viewMode.toUpperCase()} Mode
            </Badge>
            <Text>Zoom with scroll, drag to pan{viewMode !== '2d' && ', Ctrl+drag to rotate'}</Text>
          </HStack>
        </HStack>
      </Box>
    </Card>
  )
}

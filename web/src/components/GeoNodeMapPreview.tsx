import { useEffect, useRef, useState, useCallback } from 'react'
import { getApiBase } from '../config/env'
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
  ButtonGroup,
  Divider,
} from '@chakra-ui/react'
import { FiRefreshCw, FiX, FiBox, FiMap, FiExternalLink } from 'react-icons/fi'
import { TbWorld } from 'react-icons/tb'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useUIStore, type MapViewState } from '../stores/uiStore'

interface GeoNodeMapPreviewProps {
  geonodeUrl: string      // Base URL of GeoNode (e.g., https://mygeocommunity.org) - kept for reference only
  layerName: string       // The alternate field (e.g., geonode:layer_name)
  title: string           // Display title
  connectionId: string    // GeoNode connection ID - used for WMS proxy
  detailUrl?: string      // Full URL to view this resource in GeoNode
  onClose?: () => void
}

type ViewMode = '2d' | '3d'

export default function GeoNodeMapPreview({
  geonodeUrl,
  layerName,
  title,
  connectionId,
  detailUrl,
  onClose,
}: GeoNodeMapPreviewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const [refreshKey, setRefreshKey] = useState(0)

  // Get stored map view state
  const geonodeMapView = useUIStore((state) => state.geonodeMapView)
  const setGeoNodeMapView = useUIStore((state) => state.setGeoNodeMapView)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const metaBg = useColorModeValue('gray.50', 'gray.700')

  // Build WMS tile URL using our proxy to avoid CORS issues
  const buildWmsTileUrl = (cacheBuster?: string): string => {
    // Use our backend proxy to avoid CORS issues with external GeoServers
    const proxyUrl = `${getApiBase()}/geonode/connections/${connectionId}/wms`

    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      LAYERS: layerName,
      FORMAT: 'image/png',
      TRANSPARENT: 'true',
      SRS: 'EPSG:3857',
      WIDTH: '256',
      HEIGHT: '256',
    })

    if (cacheBuster) {
      params.set('_t', cacheBuster)
    }

    // Append BBOX with the unencoded MapLibre placeholder
    return `${proxyUrl}?${params.toString()}&BBOX={bbox-epsg-3857}`
  }

  // Save map view state when map moves
  const saveMapView = useCallback(() => {
    if (!map.current) return
    const center = map.current.getCenter()
    const view: MapViewState = {
      center: [center.lng, center.lat],
      zoom: map.current.getZoom(),
      pitch: map.current.getPitch(),
      bearing: map.current.getBearing(),
    }
    setGeoNodeMapView(view)
  }, [setGeoNodeMapView])

  // Initialize map (only once)
  useEffect(() => {
    if (!mapContainer.current) return

    // Use stored view state or defaults
    const initialCenter = geonodeMapView?.center ?? [0, 20]
    const initialZoom = geonodeMapView?.zoom ?? 2
    const initialPitch = geonodeMapView?.pitch ?? 0
    const initialBearing = geonodeMapView?.bearing ?? 0

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
            attribution: '&copy; OpenStreetMap contributors',
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
      center: initialCenter as [number, number],
      zoom: initialZoom,
      pitch: initialPitch,
      bearing: initialBearing,
    })

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left')

    // Track map movements to persist view state
    map.current.on('moveend', saveMapView)

    map.current.on('load', () => {
      setMapLoaded(true)
    })

    return () => {
      if (map.current) {
        map.current.off('moveend', saveMapView)
        map.current.remove()
        map.current = null
        setMapLoaded(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount - don't include geonodeMapView or it will re-create the map

  // Add WMS layer when map is loaded
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    const wmsTileUrl = buildWmsTileUrl(refreshKey > 0 ? String(refreshKey) : undefined)

    console.log('[GeoNodeMapPreview] WMS tile URL:', wmsTileUrl)

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

    // Try to get layer bounds from GeoServer capabilities
    // For now, we'll just keep the world view
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, layerName, connectionId, refreshKey])

  // Update view mode (2D/3D)
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
    setRefreshKey(Date.now())
  }

  const openInGeoNode = () => {
    // Use the detail URL if provided, otherwise we can't reliably construct the URL
    if (detailUrl) {
      window.open(detailUrl, '_blank')
    } else {
      // Fallback: try to open the GeoNode base URL
      window.open(geonodeUrl, '_blank')
    }
  }

  return (
    <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
      {/* Header */}
      <Box
        bg="linear-gradient(135deg, #0d7377 0%, #14919b 50%, #2dc2c9 100%)"
        color="white"
        px={4}
        py={3}
      >
        <HStack justify="space-between">
          <VStack align="start" spacing={0}>
            <HStack>
              <TbWorld size={20} />
              <Heading size="sm" color="white">
                GeoNode Layer Preview
              </Heading>
              <Badge colorScheme="whiteAlpha" variant="solid" fontSize="xs">
                WMS
              </Badge>
            </HStack>
            <Text fontSize="xs" color="whiteAlpha.800">
              {title || layerName}
            </Text>
          </VStack>
          <HStack spacing={2}>
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

            <Divider orientation="vertical" h="24px" borderColor="whiteAlpha.400" />

            <Tooltip label="Open in GeoNode">
              <IconButton
                aria-label="Open in GeoNode"
                icon={<FiExternalLink />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={openInGeoNode}
              />
            </Tooltip>
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
            <Spinner size="xl" color="teal.500" />
            <Text mt={2} color="gray.600">Loading map...</Text>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box px={4} py={2} bg={metaBg} borderTop="1px solid" borderColor={borderColor}>
        <HStack justify="space-between" fontSize="xs" color="gray.500">
          <Text>
            Layer: {layerName}
          </Text>
          <HStack spacing={4}>
            <Badge colorScheme={viewMode === '2d' ? 'blue' : 'purple'}>
              {viewMode.toUpperCase()} Mode
            </Badge>
            <Text>Zoom with scroll, drag to pan{viewMode !== '2d' && ', Ctrl+drag to rotate'}</Text>
          </HStack>
        </HStack>
      </Box>
    </Card>
  )
}

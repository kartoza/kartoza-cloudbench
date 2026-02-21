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
  Divider,
  Alert,
  AlertIcon,
  AlertDescription,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  SliderMark,
} from '@chakra-ui/react'
import { FiInfo, FiRefreshCw, FiX, FiMap, FiBox, FiDownload, FiTriangle } from 'react-icons/fi'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LidarControl } from 'maplibre-gl-lidar'
import 'maplibre-gl-lidar/style.css'
import * as GeoTIFF from 'geotiff'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import * as api from '../api/client'
import type { S3PreviewMetadata } from '../types'

// Disable Cesium Ion (we don't use it)
Cesium.Ion.defaultAccessToken = ''

interface S3LayerPreviewProps {
  connectionId: string
  bucketName: string
  objectKey: string
  onClose?: () => void
}

type ViewMode = '2d' | '3d' | 'dem3d'

export default function S3LayerPreview({
  connectionId,
  bucketName,
  objectKey,
  onClose,
}: S3LayerPreviewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const cesiumContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const cesiumViewer = useRef<Cesium.Viewer | null>(null)
  // Point cloud refs
  const pointCloudMapContainer = useRef<HTMLDivElement>(null)
  const pointCloudMap = useRef<maplibregl.Map | null>(null)
  const lidarControl = useRef<LidarControl | null>(null)

  const [showMetadata, setShowMetadata] = useState(false)
  const [metadata, setMetadata] = useState<S3PreviewMetadata | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [cesiumLoaded, setCesiumLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const [verticalExaggeration, setVerticalExaggeration] = useState(1.5)
  const [pointCloudLoaded, setPointCloudLoaded] = useState(false)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const metaBg = useColorModeValue('gray.50', 'gray.700')

  // Extract filename from object key
  const fileName = objectKey.split('/').pop() || objectKey

  // Fetch preview metadata
  useEffect(() => {
    setIsLoading(true)
    setError(null)

    api.getS3PreviewMetadata(connectionId, bucketName, objectKey)
      .then((data) => {
        setMetadata(data)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch S3 preview metadata:', err)
        setError(err.message || 'Failed to load preview')
        setIsLoading(false)
      })
  }, [connectionId, bucketName, objectKey])

  // Initialize map when metadata is loaded
  useEffect(() => {
    if (!mapContainer.current || !metadata || metadata.previewType === 'pointcloud') return

    // Get bounds or use world bounds as default
    const bounds: [number, number, number, number] = metadata.bounds
      ? [metadata.bounds.minX, metadata.bounds.minY, metadata.bounds.maxX, metadata.bounds.maxY]
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
  }, [metadata])

  // Add data layer when map is loaded
  useEffect(() => {
    if (!map.current || !mapLoaded || !metadata) return

    // Add the appropriate layer based on format
    if (metadata.previewType === 'raster' && (metadata.format === 'cog' || metadata.format === 'geotiff')) {
      // COG/GeoTIFF: Use geotiff.js to read and render as image overlay
      const loadCOG = async () => {
        try {
          const proxyUrl = metadata.proxyUrl
          const tiff = await GeoTIFF.fromUrl(proxyUrl)
          const image = await tiff.getImage()

          // Get image dimensions
          const width = image.getWidth()
          const height = image.getHeight()

          // Read raster data (use overview for large images)
          const targetWidth = Math.min(width, 1024)
          const targetHeight = Math.round(height * (targetWidth / width))

          const rasters = await image.readRasters({
            width: targetWidth,
            height: targetHeight,
          })

          // Create canvas to render the image
          const canvas = document.createElement('canvas')
          canvas.width = targetWidth
          canvas.height = targetHeight
          const ctx = canvas.getContext('2d')

          if (ctx && rasters) {
            const imageData = ctx.createImageData(targetWidth, targetHeight)
            const data = imageData.data

            // Handle different band configurations
            const numBands = rasters.length
            const band0 = rasters[0] as Uint8Array | Uint16Array | Float32Array
            const band1 = numBands > 1 ? rasters[1] as Uint8Array | Uint16Array | Float32Array : band0
            const band2 = numBands > 2 ? rasters[2] as Uint8Array | Uint16Array | Float32Array : band0

            // Calculate min/max for normalization
            let min = Infinity, max = -Infinity
            for (let i = 0; i < band0.length; i++) {
              if (band0[i] !== 0) { // Skip nodata
                min = Math.min(min, band0[i])
                max = Math.max(max, band0[i])
              }
            }
            const range = max - min || 1

            // Fill image data
            for (let i = 0; i < band0.length; i++) {
              const idx = i * 4
              if (numBands >= 3) {
                // RGB image - normalize if needed
                const scale = max > 255 ? 255 / max : 1
                data[idx] = Math.round((band0[i] as number) * scale)
                data[idx + 1] = Math.round((band1[i] as number) * scale)
                data[idx + 2] = Math.round((band2[i] as number) * scale)
              } else {
                // Grayscale - normalize to 0-255
                const val = Math.round(((band0[i] as number) - min) / range * 255)
                data[idx] = val
                data[idx + 1] = val
                data[idx + 2] = val
              }
              data[idx + 3] = band0[i] === 0 ? 0 : 255 // Alpha (transparent for nodata)
            }

            ctx.putImageData(imageData, 0, 0)

            // Add as image source to map
            const bounds = metadata.bounds
            if (bounds && map.current) {
              map.current.addSource('s3-layer', {
                type: 'image',
                url: canvas.toDataURL(),
                coordinates: [
                  [bounds.minX, bounds.maxY], // top-left
                  [bounds.maxX, bounds.maxY], // top-right
                  [bounds.maxX, bounds.minY], // bottom-right
                  [bounds.minX, bounds.minY], // bottom-left
                ],
              })

              map.current.addLayer({
                id: 's3-layer',
                type: 'raster',
                source: 's3-layer',
                paint: {
                  'raster-opacity': 1,
                },
              })
            }
          }
        } catch (err) {
          console.error('Failed to load COG:', err)
        }
      }

      loadCOG()
    } else if (metadata.previewType === 'vector' && (metadata.format === 'geojson' || metadata.format === 'geoparquet')) {
      // GeoJSON: Load directly from proxy URL
      if (metadata.format === 'geojson') {
        map.current.addSource('s3-layer', {
          type: 'geojson',
          data: metadata.proxyUrl,
        })

        // Add fill layer for polygons
        map.current.addLayer({
          id: 's3-layer-fill',
          type: 'fill',
          source: 's3-layer',
          paint: {
            'fill-color': '#0080ff',
            'fill-opacity': 0.4,
          },
          filter: ['==', '$type', 'Polygon'],
        })

        // Add line layer for lines and polygon outlines
        map.current.addLayer({
          id: 's3-layer-line',
          type: 'line',
          source: 's3-layer',
          paint: {
            'line-color': '#0060c0',
            'line-width': 2,
          },
          filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
        })

        // Add circle layer for points
        map.current.addLayer({
          id: 's3-layer-point',
          type: 'circle',
          source: 's3-layer',
          paint: {
            'circle-radius': 6,
            'circle-color': '#0080ff',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
          filter: ['==', '$type', 'Point'],
        })
      } else if (metadata.format === 'geoparquet') {
        // GeoParquet: Needs server-side conversion or specialized library
        // For now, show a message that it requires processing
        console.log('GeoParquet format detected - requires server-side conversion for preview')
      }
    }

    // Fit to bounds if available
    if (metadata.bounds) {
      const bounds: [number, number, number, number] = [
        metadata.bounds.minX,
        metadata.bounds.minY,
        metadata.bounds.maxX,
        metadata.bounds.maxY,
      ]
      map.current.fitBounds(bounds, { padding: 50, maxZoom: 15 })
    }
  }, [mapLoaded, metadata])

  // Update view mode (2D/3D) for MapLibre
  useEffect(() => {
    if (!map.current || !mapLoaded || viewMode === 'dem3d') return

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

  // Initialize Cesium viewer for DEM 3D mode
  useEffect(() => {
    if (viewMode !== 'dem3d' || !cesiumContainer.current || !metadata) return

    // Clean up existing viewer
    if (cesiumViewer.current) {
      cesiumViewer.current.destroy()
      cesiumViewer.current = null
    }

    setCesiumLoaded(false)

    // Create Cesium viewer
    const viewer = new Cesium.Viewer(cesiumContainer.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      scene3DOnly: true,
      creditContainer: document.createElement('div'),
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
        )
      ),
    })

    cesiumViewer.current = viewer

    // Apply vertical exaggeration
    viewer.scene.verticalExaggeration = verticalExaggeration

    // If we have bounds, fly to them
    if (metadata.bounds) {
      const { minX, minY, maxX, maxY } = metadata.bounds
      const rectangle = Cesium.Rectangle.fromDegrees(minX, minY, maxX, maxY)
      viewer.camera.flyTo({
        destination: rectangle,
        duration: 1,
      })
    }

    // Add the DEM as a draped image overlay
    // For proper DEM terrain, we'd need quantized mesh or heightmap tiles
    // For now, drape the raster as imagery with elevation coloring
    const loadDEMImagery = async () => {
      try {
        const proxyUrl = window.location.origin + metadata.proxyUrl
        const tiff = await GeoTIFF.fromUrl(proxyUrl)
        const image = await tiff.getImage()

        const width = image.getWidth()
        const height = image.getHeight()
        const targetWidth = Math.min(width, 1024)
        const targetHeight = Math.round(height * (targetWidth / width))

        const rasters = await image.readRasters({
          width: targetWidth,
          height: targetHeight,
        })

        // Create canvas with elevation-colored visualization
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')

        if (ctx && rasters) {
          const imageData = ctx.createImageData(targetWidth, targetHeight)
          const data = imageData.data
          const band0 = rasters[0] as Float32Array | Uint16Array | Uint8Array

          // Calculate min/max for normalization
          let min = Infinity, max = -Infinity
          for (let i = 0; i < band0.length; i++) {
            const val = band0[i] as number
            if (val !== 0 && val !== -9999 && !isNaN(val)) {
              min = Math.min(min, val)
              max = Math.max(max, val)
            }
          }
          const range = max - min || 1

          // Apply terrain color ramp (blue-green-yellow-red-white)
          for (let i = 0; i < band0.length; i++) {
            const idx = i * 4
            const val = band0[i] as number

            if (val === 0 || val === -9999 || isNaN(val)) {
              // Nodata - transparent
              data[idx] = 0
              data[idx + 1] = 0
              data[idx + 2] = 0
              data[idx + 3] = 0
            } else {
              const normalized = (val - min) / range

              // Terrain color ramp
              let r, g, b
              if (normalized < 0.2) {
                // Blue to cyan
                const t = normalized / 0.2
                r = 0
                g = Math.round(100 * t)
                b = Math.round(150 + 50 * t)
              } else if (normalized < 0.4) {
                // Cyan to green
                const t = (normalized - 0.2) / 0.2
                r = 0
                g = Math.round(100 + 100 * t)
                b = Math.round(200 - 150 * t)
              } else if (normalized < 0.6) {
                // Green to yellow
                const t = (normalized - 0.4) / 0.2
                r = Math.round(200 * t)
                g = 200
                b = Math.round(50 - 50 * t)
              } else if (normalized < 0.8) {
                // Yellow to red
                const t = (normalized - 0.6) / 0.2
                r = Math.round(200 + 55 * t)
                g = Math.round(200 - 150 * t)
                b = 0
              } else {
                // Red to white (snow)
                const t = (normalized - 0.8) / 0.2
                r = 255
                g = Math.round(50 + 205 * t)
                b = Math.round(255 * t)
              }

              data[idx] = r
              data[idx + 1] = g
              data[idx + 2] = b
              data[idx + 3] = 255
            }
          }

          ctx.putImageData(imageData, 0, 0)

          // Add as imagery layer in Cesium
          if (metadata.bounds && cesiumViewer.current) {
            const { minX, minY, maxX, maxY } = metadata.bounds
            const imageryProvider = new Cesium.SingleTileImageryProvider({
              url: canvas.toDataURL(),
              rectangle: Cesium.Rectangle.fromDegrees(minX, minY, maxX, maxY),
            })
            cesiumViewer.current.imageryLayers.addImageryProvider(imageryProvider)
          }
        }

        setCesiumLoaded(true)
      } catch (err) {
        console.error('Failed to load DEM for Cesium:', err)
        setCesiumLoaded(true)
      }
    }

    loadDEMImagery()

    return () => {
      if (cesiumViewer.current) {
        cesiumViewer.current.destroy()
        cesiumViewer.current = null
      }
    }
  }, [viewMode, metadata])

  // Update vertical exaggeration when slider changes
  useEffect(() => {
    if (cesiumViewer.current) {
      cesiumViewer.current.scene.verticalExaggeration = verticalExaggeration
    }
  }, [verticalExaggeration])

  // Initialize maplibre-gl-lidar for point cloud preview
  useEffect(() => {
    if (!pointCloudMapContainer.current || metadata?.previewType !== 'pointcloud') return

    // Clean up any existing map
    if (pointCloudMap.current) {
      pointCloudMap.current.remove()
      pointCloudMap.current = null
      lidarControl.current = null
    }

    // Get center from bounds if available
    const center: [number, number] = metadata.bounds
      ? [(metadata.bounds.minX + metadata.bounds.maxX) / 2, (metadata.bounds.minY + metadata.bounds.maxY) / 2]
      : [0, 0]

    // Create the map with a dark style for point cloud visualization
    const mapInstance = new maplibregl.Map({
      container: pointCloudMapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center,
      zoom: 14,
      pitch: 60,
      maxPitch: 85,
    })

    pointCloudMap.current = mapInstance

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapInstance.addControl(new maplibregl.ScaleControl(), 'bottom-left')

    mapInstance.on('load', () => {
      // Create the LidarControl
      const control = new LidarControl({
        collapsed: true,
        pointSize: 2,
        colorScheme: 'elevation',
        pickable: true,
      })

      lidarControl.current = control
      mapInstance.addControl(control, 'top-right')

      // Load the point cloud from the proxy URL
      const copcUrl = window.location.origin + metadata.proxyUrl
      control.loadPointCloud(copcUrl)
      setPointCloudLoaded(true)
    })

    return () => {
      if (pointCloudMap.current) {
        pointCloudMap.current.remove()
        pointCloudMap.current = null
        lidarControl.current = null
        setPointCloudLoaded(false)
      }
    }
  }, [metadata])

  const handleRefresh = () => {
    setIsLoading(true)
    setError(null)

    api.getS3PreviewMetadata(connectionId, bucketName, objectKey)
      .then((data) => {
        setMetadata(data)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to load preview')
        setIsLoading(false)
      })
  }

  const handleDownload = () => {
    if (metadata?.proxyUrl) {
      window.open(metadata.proxyUrl, '_blank')
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const getFormatBadgeColor = (format: string): string => {
    switch (format) {
      case 'cog': return 'green'
      case 'copc': return 'purple'
      case 'geoparquet': return 'blue'
      case 'geojson': return 'cyan'
      case 'geotiff': return 'orange'
      default: return 'gray'
    }
  }

  const getPreviewTypeBadgeColor = (type: string): string => {
    switch (type) {
      case 'raster': return 'orange'
      case 'vector': return 'blue'
      case 'pointcloud': return 'purple'
      default: return 'gray'
    }
  }

  // Show loading state
  if (isLoading) {
    return (
      <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
        <Box
          bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
          color="white"
          px={4}
          py={3}
        >
          <HStack justify="space-between">
            <VStack align="start" spacing={0}>
              <Heading size="sm" color="white">S3 Layer Preview</Heading>
              <Text fontSize="xs" color="whiteAlpha.800">{bucketName}/{objectKey}</Text>
            </VStack>
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
        </Box>
        <Box flex="1" display="flex" alignItems="center" justifyContent="center">
          <VStack spacing={4}>
            <Spinner size="xl" color="kartoza.500" />
            <Text color="gray.600">Loading preview metadata...</Text>
          </VStack>
        </Box>
      </Card>
    )
  }

  // Show error state
  if (error) {
    return (
      <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
        <Box
          bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
          color="white"
          px={4}
          py={3}
        >
          <HStack justify="space-between">
            <VStack align="start" spacing={0}>
              <Heading size="sm" color="white">S3 Layer Preview</Heading>
              <Text fontSize="xs" color="whiteAlpha.800">{bucketName}/{objectKey}</Text>
            </VStack>
            <HStack>
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
        <Box flex="1" display="flex" alignItems="center" justifyContent="center" p={4}>
          <Alert status="error" maxW="md">
            <AlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </Box>
      </Card>
    )
  }

  if (metadata?.previewType === 'pointcloud') {
    return (
      <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
        <Box
          bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
          color="white"
          px={4}
          py={3}
        >
          <HStack justify="space-between">
            <VStack align="start" spacing={0}>
              <HStack>
                <Heading size="sm" color="white">S3 Layer Preview</Heading>
                <Badge colorScheme="purple" variant="solid" fontSize="xs">Point Cloud</Badge>
              </HStack>
              <Text fontSize="xs" color="whiteAlpha.800">{fileName}</Text>
            </VStack>
            <HStack spacing={2}>
              <Tooltip label="Download">
                <IconButton
                  aria-label="Download"
                  icon={<FiDownload />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={handleDownload}
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
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="500">Format</Text>
                <Badge colorScheme={getFormatBadgeColor(metadata.format)}>{metadata.format.toUpperCase()}</Badge>
              </Box>
              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="500">Size</Text>
                <Text fontSize="sm">{formatSize(metadata.size)}</Text>
              </Box>
              {metadata.crs && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">CRS</Text>
                  <Text fontSize="sm" fontFamily="mono">{metadata.crs}</Text>
                </Box>
              )}
              {metadata.bounds && (
                <Box gridColumn={{ md: 'span 2', lg: 'span 3' }}>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">Bounding Box</Text>
                  <Text fontSize="sm" fontFamily="mono">
                    [{metadata.bounds.minX.toFixed(4)}, {metadata.bounds.minY.toFixed(4)}] -
                    [{metadata.bounds.maxX.toFixed(4)}, {metadata.bounds.maxY.toFixed(4)}]
                  </Text>
                </Box>
              )}
            </SimpleGrid>
          </Box>
        </Collapse>

        {/* Point Cloud Viewer - using maplibre-gl-lidar */}
        <Box flex="1" position="relative" bg="gray.900" minH="400px">
          <Box
            ref={pointCloudMapContainer}
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
          />
          {!pointCloudLoaded && (
            <Box
              position="absolute"
              top="50%"
              left="50%"
              transform="translate(-50%, -50%)"
              textAlign="center"
              zIndex={10}
            >
              <Spinner size="xl" color="purple.400" />
              <Text mt={2} color="white">Loading point cloud...</Text>
            </Box>
          )}
        </Box>

        {/* Footer */}
        <Box px={4} py={2} bg={metaBg} borderTop="1px solid" borderColor={borderColor}>
          <HStack justify="space-between" fontSize="xs" color="gray.500">
            <Text>Bucket: {bucketName}</Text>
            <HStack spacing={4}>
              <Badge colorScheme="purple">LiDAR Viewer</Badge>
              <Text>Drag to rotate, scroll to zoom, click for info</Text>
            </HStack>
          </HStack>
        </Box>
      </Card>
    )
  }

  // Raster and Vector preview (MapLibre)
  return (
    <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
      {/* Header */}
      <Box
        bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
        color="white"
        px={4}
        py={3}
      >
        <HStack justify="space-between">
          <VStack align="start" spacing={0}>
            <HStack>
              <Heading size="sm" color="white">S3 Layer Preview</Heading>
              {metadata && (
                <Badge colorScheme={getPreviewTypeBadgeColor(metadata.previewType)} variant="solid" fontSize="xs">
                  {metadata.previewType.charAt(0).toUpperCase() + metadata.previewType.slice(1)}
                </Badge>
              )}
            </HStack>
            <Text fontSize="xs" color="whiteAlpha.800">{fileName}</Text>
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
              {/* DEM 3D View - only for single-band rasters (potential DEMs) */}
              {metadata?.previewType === 'raster' && metadata?.bandCount === 1 && (
                <Tooltip label="DEM 3D Terrain View">
                  <IconButton
                    aria-label="DEM 3D"
                    icon={<FiTriangle />}
                    color="white"
                    bg={viewMode === 'dem3d' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => setViewMode('dem3d')}
                  />
                </Tooltip>
              )}
            </ButtonGroup>

            <Divider orientation="vertical" h="24px" borderColor="whiteAlpha.400" />

            <Tooltip label="Download">
              <IconButton
                aria-label="Download"
                icon={<FiDownload />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleDownload}
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
          {metadata && (
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="500">Format</Text>
                <Badge colorScheme={getFormatBadgeColor(metadata.format)}>{metadata.format.toUpperCase()}</Badge>
              </Box>
              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="500">Type</Text>
                <Badge colorScheme={getPreviewTypeBadgeColor(metadata.previewType)}>
                  {metadata.previewType.charAt(0).toUpperCase() + metadata.previewType.slice(1)}
                </Badge>
              </Box>
              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="500">Size</Text>
                <Text fontSize="sm">{formatSize(metadata.size)}</Text>
              </Box>
              {metadata.crs && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">CRS</Text>
                  <Text fontSize="sm" fontFamily="mono">{metadata.crs}</Text>
                </Box>
              )}
              {metadata.bounds && (
                <Box gridColumn={{ md: 'span 2', lg: 'span 3' }}>
                  <Text fontSize="xs" color="gray.500" fontWeight="500">Bounding Box</Text>
                  <Text fontSize="sm" fontFamily="mono">
                    [{metadata.bounds.minX.toFixed(4)}, {metadata.bounds.minY.toFixed(4)}] -
                    [{metadata.bounds.maxX.toFixed(4)}, {metadata.bounds.maxY.toFixed(4)}]
                  </Text>
                </Box>
              )}
            </SimpleGrid>
          )}
        </Box>
      </Collapse>

      {/* Map/Cesium Container */}
      <Box
        flex="1"
        minH="300px"
        position="relative"
        bg="gray.100"
      >
        {/* MapLibre container - hidden in DEM 3D mode */}
        <Box
          ref={mapContainer}
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display={viewMode === 'dem3d' ? 'none' : 'block'}
        />
        {/* Cesium container - shown only in DEM 3D mode */}
        <Box
          ref={cesiumContainer}
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display={viewMode === 'dem3d' ? 'block' : 'none'}
        />
        {/* Loading spinner for MapLibre */}
        {viewMode !== 'dem3d' && !mapLoaded && (
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
        {/* Loading spinner for Cesium */}
        {viewMode === 'dem3d' && !cesiumLoaded && (
          <Box
            position="absolute"
            top="50%"
            left="50%"
            transform="translate(-50%, -50%)"
            textAlign="center"
            zIndex={10}
          >
            <Spinner size="xl" color="kartoza.500" />
            <Text mt={2} color="gray.600">Loading DEM 3D view...</Text>
          </Box>
        )}
        {/* Vertical Exaggeration Slider - shown in DEM 3D mode */}
        {viewMode === 'dem3d' && (
          <Box
            position="absolute"
            bottom={4}
            left={4}
            right={4}
            bg="blackAlpha.700"
            borderRadius="lg"
            p={4}
            zIndex={10}
          >
            <HStack spacing={4}>
              <Text color="white" fontSize="sm" fontWeight="500" minW="180px">
                Vertical Exaggeration: {verticalExaggeration.toFixed(1)}x
              </Text>
              <Slider
                aria-label="Vertical Exaggeration"
                value={verticalExaggeration}
                min={0.5}
                max={5}
                step={0.1}
                onChange={(val) => setVerticalExaggeration(val)}
                flex="1"
              >
                <SliderMark value={1} mt={2} ml={-2} fontSize="xs" color="whiteAlpha.700">
                  1x
                </SliderMark>
                <SliderMark value={2.5} mt={2} ml={-2} fontSize="xs" color="whiteAlpha.700">
                  2.5x
                </SliderMark>
                <SliderMark value={5} mt={2} ml={-2} fontSize="xs" color="whiteAlpha.700">
                  5x
                </SliderMark>
                <SliderTrack bg="whiteAlpha.300">
                  <SliderFilledTrack bg="kartoza.500" />
                </SliderTrack>
                <SliderThumb boxSize={4} />
              </Slider>
            </HStack>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box px={4} py={2} bg={metaBg} borderTop="1px solid" borderColor={borderColor}>
        <HStack justify="space-between" fontSize="xs" color="gray.500">
          <Text>Bucket: {bucketName}</Text>
          <HStack spacing={4}>
            <Badge colorScheme={viewMode === '2d' ? 'blue' : viewMode === 'dem3d' ? 'green' : 'purple'}>
              {viewMode === 'dem3d' ? 'DEM 3D' : viewMode.toUpperCase()} Mode
            </Badge>
            <Text>
              {viewMode === 'dem3d'
                ? 'Drag to rotate, scroll to zoom'
                : `Zoom with scroll, drag to pan${viewMode !== '2d' ? ', Ctrl+drag to rotate' : ''}`}
            </Text>
          </HStack>
        </HStack>
      </Box>
    </Card>
  )
}

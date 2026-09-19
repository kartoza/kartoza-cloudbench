import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Flex, HStack, VStack, Text, IconButton, Select, Tooltip, Button } from '@chakra-ui/react'
import { FiX, FiChevronDown, FiAlertTriangle, FiClock } from 'react-icons/fi'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PMTiles, Protocol } from 'pmtiles'
import { cogProtocol, getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import { getS3Connections, getS3Buckets } from '../../api/s3'
import { listPmtilesObjects, listCogObjects, getS3PresignedUrl } from '../../api/mapExplorer'
import type { S3Connection, S3Bucket } from '../../types'
import StacCataloguePage from './StacCataloguePage'
import type { MapTarget } from './StacCataloguePage'
import LayersPanel from './LayersPanel'
import type { MapLayerState } from './types'
import { getMapExplorerTabUrlParam, setMapExplorerTabUrlParam } from '../../utils/mapViewUrl'
import './styles.css'

const LAYER_COLORS = ['#2d7d9b', '#E8A331', '#7c5cbf', '#3f9142', '#c2434f', '#3a8fa6']

async function addCogLayer(
  mapInstance: maplibregl.Map,
  layerId: string,
  url: string,
  opacity: number
): Promise<[number, number, number, number]> {
  const metadata = await getCogMetadata(url)
  if (!metadata.bbox) throw new Error('COG has no readable bounding box.')

  mapInstance.addSource(layerId, {
    type: 'raster',
    url: `cog://${url}`,
    tileSize: 256,
  })
  mapInstance.addLayer({
    id: layerId,
    type: 'raster',
    source: layerId,
    paint: { 'raster-opacity': opacity / 100 },
  })

  return metadata.bbox
}

interface MapExplorerViewProps {
  onClose: () => void
}

export default function MapExplorerView({ onClose }: MapExplorerViewProps) {
  const [view, setViewState] = useState<'map' | 'catalogue'>(() => getMapExplorerTabUrlParam())
  const setView = useCallback((next: 'map' | 'catalogue') => {
    setViewState(next)
    setMapExplorerTabUrlParam(next)
  }, [])
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const protocolRef = useRef<Protocol | null>(null)
  const activeLayerIdsRef = useRef<string[]>([])

  const [mapReady, setMapReady] = useState(false)
  const [connections, setConnections] = useState<S3Connection[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [buckets, setBuckets] = useState<S3Bucket[]>([])
  const [bucketName, setBucketName] = useState('')
  const [layers, setLayers] = useState<MapLayerState[]>([])
  const [isLoadingSources, setIsLoadingSources] = useState(false)
  const pendingBucketRef = useRef<string | null>(null)

  const failedCount = layers.filter((l) => l.status === 'error').length

  // Set up the map + pmtiles/cog protocols once.
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    const protocol = new Protocol()
    protocolRef.current = protocol
    maplibregl.addProtocol('pmtiles', protocol.tile)
    maplibregl.addProtocol('cog', cogProtocol)

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors © CARTO',
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: [10, 45],
      zoom: 3,
    })
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapInstance.on('load', () => setMapReady(true))
    map.current = mapInstance

    return () => {
      mapInstance.remove()
      map.current = null
      maplibregl.removeProtocol('pmtiles')
      maplibregl.removeProtocol('cog')
    }
  }, [])

  // Load S3 connections on mount.
  useEffect(() => {
    getS3Connections()
      .then((conns) => {
        setConnections(conns)
        if (conns.length > 0) setConnectionId(conns[0].id)
      })
      .catch(() => setConnections([]))
  }, [])

  // Load buckets whenever the connection changes.
  useEffect(() => {
    if (!connectionId) {
      setBuckets([])
      setBucketName('')
      return
    }
    getS3Buckets(connectionId)
      .then((b) => {
        setBuckets(b)
        const pending = pendingBucketRef.current
        pendingBucketRef.current = null
        if (pending && b.some((bucket) => bucket.name === pending)) {
          setBucketName(pending)
        } else {
          setBucketName(b.length > 0 ? b[0].name : '')
        }
      })
      .catch(() => {
        setBuckets([])
        setBucketName('')
      })
  }, [connectionId])

  // Discover .pmtiles objects in the selected bucket and render them.
  useEffect(() => {
    const mapInstance = map.current
    if (!mapReady || !mapInstance || !connectionId || !bucketName) {
      setLayers([])
      return
    }

    let cancelled = false
    activeLayerIdsRef.current = []
    setIsLoadingSources(true)

    async function run(mapInstance: maplibregl.Map) {
      const [pmtilesObjects, cogObjects] = await Promise.all([
        listPmtilesObjects(connectionId, bucketName).catch(() => []),
        listCogObjects(connectionId, bucketName).catch(() => []),
      ])
      if (cancelled) return

      const initialLayers: MapLayerState[] = [
        ...pmtilesObjects.map((obj, i) => ({
          id: `pmtiles-${i}-${obj.key.replace(/[^a-zA-Z0-9]/g, '_')}`,
          key: obj.key,
          name: obj.key.split('/').pop()?.replace(/\.pmtiles$/i, '') ?? obj.key,
          format: 'pmtiles' as const,
          color: LAYER_COLORS[i % LAYER_COLORS.length],
          opacity: 80,
          status: 'loading' as const,
        })),
        ...cogObjects.map((obj, i) => ({
          id: `cog-${i}-${obj.key.replace(/[^a-zA-Z0-9]/g, '_')}`,
          key: obj.key,
          name: obj.key.split('/').pop()?.replace(/\.tiff?$/i, '') ?? obj.key,
          format: 'cog' as const,
          color: LAYER_COLORS[(pmtilesObjects.length + i) % LAYER_COLORS.length],
          opacity: 80,
          status: 'loading' as const,
        })),
      ]
      setLayers(initialLayers)
      setIsLoadingSources(false)

      const bounds: [number, number, number, number][] = []

      for (const layer of initialLayers) {
        if (cancelled) break
        try {
          const url = await getS3PresignedUrl(connectionId, bucketName, layer.key)

          if (layer.format === 'cog') {
            const layerBounds = await addCogLayer(mapInstance, layer.id, url, layer.opacity)
            if (cancelled) break
            activeLayerIdsRef.current.push(layer.id)
            bounds.push(layerBounds)
            setLayers((prev) =>
              prev.map((l) => (l.id === layer.id ? { ...l, status: 'ready', bounds: layerBounds } : l))
            )
            continue
          }

          const pmtiles = new PMTiles(url)
          protocolRef.current?.add(pmtiles)
          const header = await pmtiles.getHeader()
          if (cancelled) break

          const sourceUrl = `pmtiles://${url}`
          const isRaster = header.tileType >= 2

          if (isRaster) {
            mapInstance.addSource(layer.id, { type: 'raster', url: sourceUrl, tileSize: 256 })
            mapInstance.addLayer({
              id: layer.id,
              type: 'raster',
              source: layer.id,
              paint: { 'raster-opacity': layer.opacity / 100 },
            })
          } else {
            const metadata = (await pmtiles.getMetadata()) as { vector_layers?: { id: string }[] }
            const sourceLayerName = metadata?.vector_layers?.[0]?.id ?? 'default'
            mapInstance.addSource(layer.id, { type: 'vector', url: sourceUrl })
            mapInstance.addLayer({
              id: `${layer.id}-fill`,
              type: 'fill',
              source: layer.id,
              'source-layer': sourceLayerName,
              paint: { 'fill-color': layer.color, 'fill-opacity': layer.opacity / 100 },
            })
            mapInstance.addLayer({
              id: `${layer.id}-line`,
              type: 'line',
              source: layer.id,
              'source-layer': sourceLayerName,
              paint: { 'line-color': layer.color, 'line-width': 1 },
            })
          }

          activeLayerIdsRef.current.push(layer.id)
          const pmtilesBounds: [number, number, number, number] = [
            header.minLon,
            header.minLat,
            header.maxLon,
            header.maxLat,
          ]
          bounds.push(pmtilesBounds)
          setLayers((prev) =>
            prev.map((l) => (l.id === layer.id ? { ...l, status: 'ready', bounds: pmtilesBounds } : l))
          )
        } catch {
          if (!cancelled) {
            setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, status: 'error' } : l)))
          }
        }
      }

      if (!cancelled && bounds.length > 0) {
        const minLon = Math.min(...bounds.map((b) => b[0]))
        const minLat = Math.min(...bounds.map((b) => b[1]))
        const maxLon = Math.max(...bounds.map((b) => b[2]))
        const maxLat = Math.max(...bounds.map((b) => b[3]))
        mapInstance.fitBounds(
          [
            [minLon, minLat],
            [maxLon, maxLat],
          ],
          { padding: 60, maxZoom: 16 }
        )
      }
    }

    run(mapInstance)

    return () => {
      cancelled = true
      try {
        for (const id of activeLayerIdsRef.current) {
          if (mapInstance.getLayer(`${id}-fill`)) mapInstance.removeLayer(`${id}-fill`)
          if (mapInstance.getLayer(`${id}-line`)) mapInstance.removeLayer(`${id}-line`)
          if (mapInstance.getLayer(id)) mapInstance.removeLayer(id)
          if (mapInstance.getSource(id)) mapInstance.removeSource(id)
        }
      } catch {
      }
      activeLayerIdsRef.current = []
    }
  }, [mapReady, connectionId, bucketName])

  const handleZoomToExtent = useCallback((bounds: [number, number, number, number]) => {
    const mapInstance = map.current
    if (!mapInstance) return
    mapInstance.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 60, maxZoom: 16 }
    )
  }, [])

  const handleOpacityChange = useCallback((layerId: string, value: number) => {
    setLayers((prev) => prev.map((l) => (l.id === layerId ? { ...l, opacity: value } : l)))
    const mapInstance = map.current
    if (!mapInstance) return
    if (mapInstance.getLayer(`${layerId}-fill`)) {
      mapInstance.setPaintProperty(`${layerId}-fill`, 'fill-opacity', value / 100)
    }
    if (mapInstance.getLayer(layerId)) {
      mapInstance.setPaintProperty(layerId, 'raster-opacity', value / 100)
    }
  }, [])

  const openOnMap = useCallback((target: MapTarget) => {
    if (target.connectionId === connectionId) {
      setBucketName(target.bucketName)
    } else {
      pendingBucketRef.current = target.bucketName
      setConnectionId(target.connectionId)
    }
    setView('map')
  }, [connectionId, setView])

  useEffect(() => {
    if (view === 'map') map.current?.resize()
  }, [view])

  const handleRemoveLayer = useCallback((layerId: string) => {
    const mapInstance = map.current
    if (mapInstance) {
      if (mapInstance.getLayer(`${layerId}-fill`)) mapInstance.removeLayer(`${layerId}-fill`)
      if (mapInstance.getLayer(`${layerId}-line`)) mapInstance.removeLayer(`${layerId}-line`)
      if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId)
      if (mapInstance.getSource(layerId)) mapInstance.removeSource(layerId)
    }
    activeLayerIdsRef.current = activeLayerIdsRef.current.filter((id) => id !== layerId)
    setLayers((prev) => prev.filter((l) => l.id !== layerId))
  }, [])

  return (
    <Box position="fixed" inset={0} zIndex={1500} bg="white" display="flex" flexDirection="column">
      {/* Top bar */}
      <Flex
        align="center"
        px={5}
        py={3}
        borderBottom="1px solid"
        borderBottomColor="gray.100"
        boxShadow="0 1px 3px rgba(0,0,0,0.04)"
        flexShrink={0}
      >
        <IconButton
          aria-label="Back to Cloudbench"
          icon={<FiX size={20} />}
          variant="ghost"
          size="sm"
          mr={3}
          onClick={onClose}
        />
        <Text fontWeight="700" fontSize="lg" color="gray.800">
          CAS Data Explorer
        </Text>
        <Box flex={1} textAlign="center">
          <Text fontSize="sm" color="gray.400" fontWeight="500">
            EN | NL
          </Text>
        </Box>
        <HStack spacing={0} bg="gray.100" borderRadius="full" p={1}>
          <Button
            size="sm"
            borderRadius="full"
            variant={view === 'catalogue' ? 'solid' : 'ghost'}
            colorScheme={view === 'catalogue' ? 'kartoza' : 'gray'}
            onClick={() => setView('catalogue')}
          >
            Catalogue
          </Button>
          <Button
            size="sm"
            borderRadius="full"
            variant={view === 'map' ? 'solid' : 'ghost'}
            colorScheme={view === 'map' ? 'kartoza' : 'gray'}
            onClick={() => setView('map')}
          >
            Map
          </Button>
        </HStack>
      </Flex>

      {/* Body */}
      <Box position="relative" flex={1} bg="gray.50">
        {view === 'catalogue' && <StacCataloguePage onOpenOnMap={openOnMap} />}

        <Box position="absolute" inset={0} display={view === 'catalogue' ? 'none' : 'block'}>
            <Box ref={mapContainer} position="absolute" inset={0} />

            {connections.length === 0 ? (
              <Flex position="absolute" inset={0} align="center" justify="center" pointerEvents="none">
                <Box bg="white" rounded="lg" shadow="md" p={4} pointerEvents="auto">
                  <Text color="gray.600" fontSize="sm">
                    No S3 connections configured. Add one from the main app first.
                  </Text>
                </Box>
              </Flex>
            ) : (
              <>
                {/* Scenario card — coming soon, not wired to real data yet */}
                <Box
                  position="absolute"
                  top={4}
                  left={4}
                  bg="white"
                  rounded="xl"
                  shadow="lg"
                  p={4}
                  w="320px"
                  opacity={0.85}
                >
                  <HStack justify="space-between" mb={3}>
                    <HStack
                      spacing={1}
                      bg="accent.50"
                      color="accent.600"
                      px={2}
                      py={0.5}
                      borderRadius="full"
                    >
                      <FiClock size={11} />
                      <Text fontSize="10px" fontWeight="700" textTransform="uppercase" letterSpacing="0.03em">
                        Coming soon
                      </Text>
                    </HStack>
                  </HStack>
                  <VStack spacing={2} align="stretch" mb={3}>
                    <Box h="6px" bg="gray.200" borderRadius="full" />
                    <Box h="6px" bg="gray.200" borderRadius="full" w="70%" />
                  </VStack>
                  <Tooltip label="Scenario selection is coming soon">
                    <Button
                      size="sm"
                      variant="outline"
                      w="100%"
                      justifyContent="space-between"
                      rightIcon={<FiChevronDown />}
                      isDisabled
                    >
                      Choose a scenario
                    </Button>
                  </Tooltip>
                </Box>

                <LayersPanel
                  layers={layers}
                  isLoadingSources={isLoadingSources}
                  onZoomToExtent={handleZoomToExtent}
                  onOpacityChange={handleOpacityChange}
                  onRemoveLayer={handleRemoveLayer}
                />

                {/* Bucket/connection source picker (bottom-left) */}
                <HStack
                  position="absolute"
                  bottom={4}
                  left={4}
                  bg="white"
                  borderRadius="full"
                  shadow="md"
                  px={4}
                  py={1}
                  spacing={2}
                >
                  <Select
                    value={connectionId}
                    onChange={(e) => setConnectionId(e.target.value)}
                    variant="unstyled"
                    size="sm"
                    w="auto"
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Text color="gray.300">/</Text>
                  <Select
                    value={bucketName}
                    onChange={(e) => setBucketName(e.target.value)}
                    variant="unstyled"
                    size="sm"
                    w="auto"
                    placeholder={buckets.length === 0 ? 'No buckets' : undefined}
                  >
                    {buckets.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </HStack>

                {/* Failed-sources banner */}
                {failedCount > 0 && (
                  <HStack
                    position="absolute"
                    bottom={4}
                    left="50%"
                    transform="translateX(-50%)"
                    bg="orange.50"
                    border="1px solid"
                    borderColor="orange.300"
                    borderRadius="full"
                    px={4}
                    py={2}
                    spacing={2}
                  >
                    <FiAlertTriangle color="#c28424" />
                    <Text fontSize="sm" color="orange.800">
                      {failedCount} source{failedCount > 1 ? 's' : ''} could not be read
                    </Text>
                  </HStack>
                )}
              </>
            )}
        </Box>
      </Box>
    </Box>
  )
}

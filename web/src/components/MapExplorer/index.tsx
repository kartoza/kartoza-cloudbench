import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Flex, HStack, VStack, Text, IconButton, Tooltip, Button } from '@chakra-ui/react'
import { FiX, FiChevronDown, FiAlertTriangle, FiClock } from 'react-icons/fi'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PMTiles, Protocol } from 'pmtiles'
import { cogProtocol, getCogMetadata } from '@geomatico/maplibre-cog-protocol'
import { getPmtilesStyle, getS3PresignedUrl, listAllLayerObjects } from '../../api/mapExplorer'
import StacCataloguePage from './StacCataloguePage'
import type { MapTarget } from './StacCataloguePage'
import LayersPanel from './LayersPanel'
import type { LayerSearchOption, MapLayerState } from './types'
import {
  getMapExplorerLayersUrlParam,
  getMapExplorerTabUrlParam,
  setMapExplorerLayersUrlParam,
  setMapExplorerTabUrlParam,
} from '../../utils/mapViewUrl'
import { clearNodeUrlParamQuietly } from '../../utils/nodeUrl'
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

interface LoadedLayerInfo {
  bounds: [number, number, number, number]
  /** Vector PMTiles layers can switch between the default coloring and a saved style; raster/COG can't. */
  isVector: boolean
  sourceLayer?: string
}

/** Removes any rendered layer(s) previously added for this id (default fill/line, or a custom style's layers). */
function removeRenderedLayers(mapInstance: maplibregl.Map, layerId: string): void {
  const ids = (mapInstance.getStyle()?.layers ?? [])
    .map((l) => l.id)
    .filter((id) => id === layerId || id.startsWith(`${layerId}-`))
  for (const id of ids) {
    if (mapInstance.getLayer(id)) mapInstance.removeLayer(id)
  }
}

/** Renders a vector PMTiles source either with the default fill/line paint, or a saved custom style's own layers. */
function applyPmtilesVectorStyle(
  mapInstance: maplibregl.Map,
  layerId: string,
  sourceLayerName: string,
  color: string,
  opacity: number,
  customStyle: Record<string, unknown> | null
): void {
  removeRenderedLayers(mapInstance, layerId)

  const customLayers = Array.isArray(customStyle?.layers) ? (customStyle.layers as Record<string, unknown>[]) : null
  if (customLayers) {
    customLayers
      .filter((layerDef) => layerDef.type !== 'background')
      .forEach((layerDef, i) => {
        mapInstance.addLayer({
          ...layerDef,
          id: `${layerId}-custom-${i}`,
          source: layerId,
          'source-layer': (layerDef['source-layer'] as string | undefined) || sourceLayerName,
        } as maplibregl.LayerSpecification)
      })
    return
  }

  mapInstance.addLayer({
    id: `${layerId}-fill`,
    type: 'fill',
    source: layerId,
    'source-layer': sourceLayerName,
    paint: { 'fill-color': color, 'fill-opacity': opacity / 100 },
  })
  mapInstance.addLayer({
    id: `${layerId}-line`,
    type: 'line',
    source: layerId,
    'source-layer': sourceLayerName,
    paint: { 'line-color': color, 'line-width': 1 },
  })
}

/** Fetches and renders a single layer's source/layer(s) onto the map. */
async function loadLayerOntoMap(
  mapInstance: maplibregl.Map,
  protocol: Protocol,
  connectionId: string,
  bucketName: string,
  layer: { id: string; key: string; format: 'pmtiles' | 'cog'; color: string; opacity: number }
): Promise<LoadedLayerInfo> {
  const url = await getS3PresignedUrl(connectionId, bucketName, layer.key)

  if (layer.format === 'cog') {
    const bounds = await addCogLayer(mapInstance, layer.id, url, layer.opacity)
    return { bounds, isVector: false }
  }

  const pmtiles = new PMTiles(url)
  protocol.add(pmtiles)
  const header = await pmtiles.getHeader()
  const sourceUrl = `pmtiles://${url}`
  const isRaster = header.tileType >= 2
  const bounds: [number, number, number, number] = [header.minLon, header.minLat, header.maxLon, header.maxLat]

  if (isRaster) {
    mapInstance.addSource(layer.id, { type: 'raster', url: sourceUrl, tileSize: 256 })
    mapInstance.addLayer({
      id: layer.id,
      type: 'raster',
      source: layer.id,
      paint: { 'raster-opacity': layer.opacity / 100 },
    })
    return { bounds, isVector: false }
  }

  const metadata = (await pmtiles.getMetadata()) as { vector_layers?: { id: string }[] }
  const sourceLayerName = metadata?.vector_layers?.[0]?.id ?? 'default'
  mapInstance.addSource(layer.id, { type: 'vector', url: sourceUrl })
  applyPmtilesVectorStyle(mapInstance, layer.id, sourceLayerName, layer.color, layer.opacity, null)

  return { bounds, isVector: true, sourceLayer: sourceLayerName }
}

function layerNameFromKey(key: string, format: 'pmtiles' | 'cog'): string {
  const base = key.split('/').pop() ?? key
  return format === 'cog' ? base.replace(/\.tiff?$/i, '') : base.replace(/\.pmtiles$/i, '')
}

/** Stable, content-derived id so the same object is never added twice and needs no counter. */
function layerIdFor(option: { connectionId: string; bucketName: string; key: string; format: 'pmtiles' | 'cog' }): string {
  const slug = `${option.connectionId}-${option.bucketName}-${option.key}`.replace(/[^a-zA-Z0-9]/g, '_')
  return `${option.format}-${slug}`
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
  const overlayContainer = useRef<HTMLDivElement | null>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const protocolRef = useRef<Protocol | null>(null)
  // Synchronous add-guard, independent of React's (batched/deferred) state
  // updates — addLayer needs to know immediately whether an id is new.
  const addedLayerIdsRef = useRef<Set<string>>(new Set())
  // Saved style JSON per layer id, once fetched — kept out of React state
  // since it's only needed imperatively (re-rendering the map layers), not
  // for any UI beyond the default/custom toggle.
  const customStylesRef = useRef<Map<string, Record<string, unknown>>>(new Map())
  // Mirror of `layers` state, readable synchronously from stable callbacks
  // (e.g. the style-mode toggle) without making them depend on `layers`.
  const layersRef = useRef<MapLayerState[]>([])

  // A stale tree-sidebar selection (e.g. `?node=s3connection:...`) has no
  // bearing here now that Map Explorer searches across every connection —
  // drop it so the URL doesn't imply a single "current" connection.
  useEffect(() => {
    clearNodeUrlParamQuietly()
  }, [])

  // Read once at mount: a shared/refreshed URL may name layers to restore —
  // consumed once the full cross-bucket catalog has loaded below.
  const pendingLayerRefsRef = useRef(getMapExplorerLayersUrlParam())

  const [mapReady, setMapReady] = useState(false)
  const [hasConnections, setHasConnections] = useState(true)
  const [availableLayers, setAvailableLayers] = useState<LayerSearchOption[]>([])
  const [layers, setLayers] = useState<MapLayerState[]>([])
  const [isLoadingSources, setIsLoadingSources] = useState(false)

  const failedCount = layers.filter((l) => l.status === 'error').length
  const searchableLayers = useMemo(
    () => availableLayers.filter((option) => !layers.some((l) => l.id === layerIdFor(option))),
    [availableLayers, layers]
  )

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

  // Adds a single layer to the map, looked up from the already-discovered catalog.
  const addLayer = useCallback((option: LayerSearchOption) => {
    const mapInstance = map.current
    const protocol = protocolRef.current
    if (!mapInstance || !protocol) return

    const id = layerIdFor(option)
    if (addedLayerIdsRef.current.has(id)) return
    addedLayerIdsRef.current.add(id)

    const newLayer: MapLayerState = {
      id,
      connectionId: option.connectionId,
      bucketName: option.bucketName,
      key: option.key,
      name: option.name,
      format: option.format,
      color: LAYER_COLORS[(addedLayerIdsRef.current.size - 1) % LAYER_COLORS.length],
      opacity: 80,
      status: 'loading',
    }
    setLayers((prev) => [...prev, newLayer])

    loadLayerOntoMap(mapInstance, protocol, option.connectionId, option.bucketName, newLayer)
      .then(({ bounds, isVector, sourceLayer }) => {
        setLayers((cur) =>
          cur.map((l) => (l.id === id ? { ...l, status: 'ready', bounds, isVector, sourceLayer } : l))
        )
        mapInstance.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 60, maxZoom: 16 }
        )

        if (!isVector || option.format !== 'pmtiles') return
        getPmtilesStyle(option.connectionId, option.bucketName, option.key).then((style) => {
          if (!style) return
          customStylesRef.current.set(id, style)
          setLayers((cur) => cur.map((l) => (l.id === id ? { ...l, hasCustomStyle: true, styleMode: 'custom' } : l)))
          applyPmtilesVectorStyle(mapInstance, id, sourceLayer ?? 'default', newLayer.color, newLayer.opacity, style)
        })
      })
      .catch(() => {
        setLayers((cur) => cur.map((l) => (l.id === id ? { ...l, status: 'error' } : l)))
      })
  }, [])

  // Always-current addLayer, callable from effects without becoming a dependency.
  const addLayerRef = useRef(addLayer)
  addLayerRef.current = addLayer

  useEffect(() => {
    layersRef.current = layers
  }, [layers])

  const handleStyleModeChange = useCallback((layerId: string, mode: 'default' | 'custom') => {
    const mapInstance = map.current
    const layer = layersRef.current.find((l) => l.id === layerId)
    if (!mapInstance || !layer) return
    const customStyle = mode === 'custom' ? (customStylesRef.current.get(layerId) ?? null) : null
    applyPmtilesVectorStyle(mapInstance, layerId, layer.sourceLayer ?? 'default', layer.color, layer.opacity, customStyle)
    setLayers((prev) => prev.map((l) => (l.id === layerId ? { ...l, styleMode: mode } : l)))
  }, [])

  useEffect(() => {
    if (!mapReady) return

    let cancelled = false
    setIsLoadingSources(true)

    listAllLayerObjects()
      .then(({ hasConnections: found, entries }) => {
        if (cancelled) return

        const options: LayerSearchOption[] = entries.map((entry) => ({
          connectionId: entry.connectionId,
          connectionName: entry.connectionName,
          bucketName: entry.bucketName,
          key: entry.key,
          name: layerNameFromKey(entry.key, entry.format),
          format: entry.format,
        }))
        setHasConnections(found)
        setAvailableLayers(options)
        setIsLoadingSources(false)

        const pendingRefs = pendingLayerRefsRef.current
        pendingLayerRefsRef.current = []
        if (pendingRefs.length > 0) {
          for (const ref of pendingRefs) {
            const match = options.find(
              (o) => o.connectionId === ref.connectionId && o.bucketName === ref.bucketName && o.key === ref.key
            )
            if (match) addLayerRef.current(match)
          }
        }
      })
      .catch(() => {
        if (cancelled) return
        setHasConnections(false)
        setAvailableLayers([])
        setIsLoadingSources(false)
      })

    return () => {
      cancelled = true
    }
  }, [mapReady])

  // Keep the added layers persisted in the URL so a refresh/shared link restores them.
  useEffect(() => {
    if (layers.length === 0 && pendingLayerRefsRef.current.length > 0) return // restore still pending
    setMapExplorerLayersUrlParam(
      layers.map((l) => ({ connectionId: l.connectionId, bucketName: l.bucketName, key: l.key }))
    )
  }, [layers])

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

  // The catalogue no longer names a single connection/bucket to switch the map
  // into — Map Explorer already searches everything — so this just switches tabs.
  const openOnMap = useCallback(
    (_target: MapTarget) => {
      setView('map')
    },
    [setView]
  )

  useEffect(() => {
    if (view === 'map') map.current?.resize()
  }, [view])

  const handleRemoveLayer = useCallback((layerId: string) => {
    const mapInstance = map.current
    if (mapInstance) {
      // Covers the raster case (plain `layerId`), the default fill/line
      // rendering, and a custom style's own layers (`${layerId}-custom-0`,
      // `-1`, ...) — removeSource below fails silently while any layer
      // still references the source, which otherwise left it (and the
      // layer) stuck on the map.
      removeRenderedLayers(mapInstance, layerId)
      if (mapInstance.getSource(layerId)) mapInstance.removeSource(layerId)
    }
    addedLayerIdsRef.current.delete(layerId)
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

        <Box ref={overlayContainer} position="absolute" inset={0} display={view === 'catalogue' ? 'none' : 'block'}>
            <Box ref={mapContainer} position="absolute" inset={0} />

            {!hasConnections ? (
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
                  availableLayers={searchableLayers}
                  isLoadingSources={isLoadingSources}
                  onAddLayer={addLayer}
                  onZoomToExtent={handleZoomToExtent}
                  onOpacityChange={handleOpacityChange}
                  onRemoveLayer={handleRemoveLayer}
                  onStyleModeChange={handleStyleModeChange}
                  dragConstraintsRef={overlayContainer}
                />

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

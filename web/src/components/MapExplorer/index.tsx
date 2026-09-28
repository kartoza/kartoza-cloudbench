import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Flex, HStack, VStack, Text, IconButton, Tooltip, Button } from '@chakra-ui/react'
import { FiX, FiChevronDown, FiAlertTriangle, FiClock } from 'react-icons/fi'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { cogProtocol } from '@geomatico/maplibre-cog-protocol'
import {
  getLayerCollection,
  getLayerCollections,
  getPmtilesStyle,
  listAllLayerObjects,
  type LayerCollectionSummary,
} from '../../api/mapExplorer'
import StacCataloguePage from './StacCataloguePage'
import type { MapTarget } from './StacCataloguePage'
import LayersPanel from './LayersPanel'
import LegendPanel from './LegendPanel'
import type { LayerSearchOption, MapLayerState } from './types'
import {
  isRenderedIdFor,
  removeRenderedLayers,
  applyPmtilesVectorStyle,
  loadLayerOntoMap,
  layerNameFromKey,
  layerIdFor,
  legendItemsFromStyle,
} from './layerLoader'
import {
  getMapExplorerLayersUrlParam,
  getMapExplorerTabUrlParam,
  setMapExplorerLayersUrlParam,
  setMapExplorerTabUrlParam,
} from '../../utils/mapViewUrl'
import { clearNodeUrlParamQuietly } from '../../utils/nodeUrl'
import './styles.css'

const LAYER_COLORS = ['#54A2CC', '#EEB348', '#3C7D54', '#B0473C', '#8A8B8B', '#383939']

const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

function buildFeaturePopupContent(layerName: string, feature: maplibregl.MapGeoJSONFeature): HTMLElement {
  const container = document.createElement('div')
  container.className = 'mx-popup'

  const header = document.createElement('div')
  header.className = 'mx-popup-header'
  const title = document.createElement('div')
  title.className = 'mx-popup-header-title'
  title.textContent = layerName
  const subtitle = document.createElement('div')
  subtitle.className = 'mx-popup-header-subtitle'
  subtitle.textContent = 'Feature attributes'
  header.appendChild(title)
  header.appendChild(subtitle)
  container.appendChild(header)

  const body = document.createElement('div')
  body.className = 'mx-popup-body'
  container.appendChild(body)

  const entries = Object.entries(feature.properties ?? {})
  if (entries.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'mx-popup-empty'
    empty.textContent = 'No attributes on this feature'
    body.appendChild(empty)
    return container
  }

  const table = document.createElement('table')
  table.className = 'mx-popup-table'
  for (const [key, value] of entries) {
    const row = table.insertRow()
    const keyCell = row.insertCell()
    keyCell.className = 'mx-popup-key'
    keyCell.textContent = key
    const valueCell = row.insertCell()
    valueCell.className = 'mx-popup-value'
    valueCell.textContent = String(value)
  }
  body.appendChild(table)
  return container
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
  const [collections, setCollections] = useState<LayerCollectionSummary[]>([])
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
      style: BASEMAP_STYLE_URL,
      center: [10, 45],
      zoom: 3,
    })
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapInstance.on('load', () => setMapReady(true))
    mapInstance.on('click', (e) => {
      const inspectableIds = (mapInstance.getStyle()?.layers ?? [])
        .map((l) => l.id)
        .filter((id) => layersRef.current.some((layer) => isRenderedIdFor(id, layer.id)))
      if (inspectableIds.length === 0) return

      const features = mapInstance.queryRenderedFeatures(e.point, { layers: inspectableIds })
      if (features.length === 0) return

      const feature = features[0]
      const parentLayer = layersRef.current.find((layer) => isRenderedIdFor(feature.layer.id, layer.id))
      new maplibregl.Popup({ maxWidth: '300px', className: 'mx-feature-popup' })
        .setLngLat(e.lngLat)
        .setDOMContent(buildFeaturePopupContent(parentLayer?.name ?? feature.layer.id, feature))
        .addTo(mapInstance)
    })
    mapInstance.on('mousemove', (e) => {
      const inspectableIds = (mapInstance.getStyle()?.layers ?? [])
        .map((l) => l.id)
        .filter((id) => layersRef.current.some((layer) => isRenderedIdFor(id, layer.id)))
      const hovering = inspectableIds.length > 0 && mapInstance.queryRenderedFeatures(e.point, { layers: inspectableIds }).length > 0
      mapInstance.getCanvas().style.cursor = hovering ? 'pointer' : ''
    })

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

    loadLayerOntoMap(mapInstance, protocol, option.connectionId, newLayer)
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
        getPmtilesStyle(option.connectionId, option.key).then((style) => {
          if (!style) return
          customStylesRef.current.set(id, style)
          setLayers((cur) => cur.map((l) => (l.id === id ? { ...l, hasCustomStyle: true, styleMode: 'custom', customLegend: legendItemsFromStyle(style) } : l)))
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

  useEffect(() => {
    if (!mapReady) return
    let cancelled = false
    getLayerCollections()
      .then((data) => {
        if (!cancelled) setCollections(data)
      })
      .catch(() => {
        if (!cancelled) setCollections([])
      })
    return () => {
      cancelled = true
    }
  }, [mapReady])

  // Adds every layer in a collection (e.g. everything produced from one
  // GeoPackage upload) to the map in one go.
  const handleAddCollection = useCallback((collectionId: string) => {
    getLayerCollection(collectionId)
      .then((collection) => {
        for (const item of collection.items) {
          addLayerRef.current({
            connectionId: collection.connectionId,
            connectionName: collection.name,
            bucketName: collection.bucket,
            key: item.key,
            name: item.name,
            format: item.format,
          })
        }
      })
      .catch(() => {
        // Best-effort — individual layer failures already surface via layer status.
      })
  }, [])

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

    // Covers every rendered layer for this id: the default `-fill`/`-line`
    // pair, a raster/cog layer (bare id), or a saved custom style's
    // `-custom-N` layers — same id-matching `removeRenderedLayers` uses.
    const renderedIds = (mapInstance.getStyle()?.layers ?? [])
      .map((l) => l.id)
      .filter((id) => id === layerId || id.startsWith(`${layerId}-`))

    for (const id of renderedIds) {
      const renderedLayer = mapInstance.getLayer(id)
      if (!renderedLayer) continue
      switch (renderedLayer.type) {
        case 'fill':
          mapInstance.setPaintProperty(id, 'fill-opacity', value / 100)
          break
        case 'line':
          mapInstance.setPaintProperty(id, 'line-opacity', value / 100)
          break
        case 'raster':
          mapInstance.setPaintProperty(id, 'raster-opacity', value / 100)
          break
        case 'circle':
          mapInstance.setPaintProperty(id, 'circle-opacity', value / 100)
          break
        case 'symbol':
          mapInstance.setPaintProperty(id, 'icon-opacity', value / 100)
          mapInstance.setPaintProperty(id, 'text-opacity', value / 100)
          break
      }
    }
  }, [])

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

  // "Open on map" from the catalogue: show that one layer on its own —
  // replacing whatever was on the map — and zoom to it (addLayer does).
  const openOnMap = useCallback(
    (target: MapTarget) => {
      setView('map')
      for (const layer of layersRef.current) handleRemoveLayer(layer.id)
      if (!mapReady) {
        // Picked up by the catalog load once the map is ready (as a URL restore is).
        pendingLayerRefsRef.current = [target]
        return
      }
      // Prefer the discovered entry (it carries the connection name); fall back
      // to the catalogue's own details for a layer uploaded since that listing.
      const option = availableLayers.find(
        (o) => o.connectionId === target.connectionId && o.bucketName === target.bucketName && o.key === target.key
      ) ?? {
        connectionId: target.connectionId,
        connectionName: '',
        bucketName: target.bucketName,
        key: target.key,
        name: layerNameFromKey(target.key, 'pmtiles'),
        format: 'pmtiles' as const,
      }
      addLayer(option)
    },
    [setView, handleRemoveLayer, mapReady, availableLayers, addLayer]
  )

  return (
    <Box position="fixed" inset={0} zIndex={1500} bg="white" display="flex" flexDirection="column">
      {/* Top bar */}
      <Flex
        align="center"
        px={5}
        py={3}
        borderBottom="1px solid"
        borderBottomColor="gray.100"
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
          Data Explorer
        </Text>
        <Box flex={1} textAlign="center">
        </Box>
        <HStack spacing={0} bg="gray.100" borderRadius="sm" p={1}>
          <Button
            size="sm"
            borderRadius="sm"
            variant={view === 'catalogue' ? 'solid' : 'ghost'}
            colorScheme={view === 'catalogue' ? 'kartoza' : 'gray'}
            onClick={() => setView('catalogue')}
          >
            Catalogue
          </Button>
          <Button
            size="sm"
            borderRadius="sm"
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
                  display="none"
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
                      borderRadius="sm"
                    >
                      <FiClock size={11} />
                      <Text fontSize="10px" fontWeight="700" textTransform="uppercase" letterSpacing="0.03em">
                        Coming soon
                      </Text>
                    </HStack>
                  </HStack>
                  <VStack spacing={2} align="stretch" mb={3}>
                    <Box h="6px" bg="gray.200" borderRadius="sm" />
                    <Box h="6px" bg="gray.200" borderRadius="sm" w="70%" />
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
                  collections={collections}
                  isLoadingSources={isLoadingSources}
                  onAddLayer={addLayer}
                  onAddCollection={handleAddCollection}
                  onZoomToExtent={handleZoomToExtent}
                  onOpacityChange={handleOpacityChange}
                  onRemoveLayer={handleRemoveLayer}
                  onStyleModeChange={handleStyleModeChange}
                  dragConstraintsRef={overlayContainer}
                />

                <LegendPanel layers={layers} dragConstraintsRef={overlayContainer} />

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
                    borderRadius="sm"
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

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Box,
  HStack,
  VStack,
  Text,
  IconButton,
  ButtonGroup,
  Tooltip,
  Badge,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  useColorModeValue,
  Spinner,
  Divider,
  Collapse,
  SimpleGrid,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Button,
  Icon,
} from '@chakra-ui/react'
import { FiGlobe, FiMap, FiBox, FiEye, FiEyeOff, FiRefreshCw, FiMaximize2, FiLayers, FiChevronDown, FiInfo } from 'react-icons/fi'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useUIStore } from '../../stores/uiStore'

// Disable Cesium Ion (we don't use it)
// vite-plugin-cesium handles CESIUM_BASE_URL automatically
Cesium.Ion.defaultAccessToken = ''

interface LayerData {
  name: string
  layer: Cesium.ImageryLayer
  visible: boolean
  opacity: number
}

export function Globe3DDialog() {
  const { activeDialog, dialogData, closeDialog } = useUIStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'3d' | '2d' | 'columbus'>('3d')
  const [layers, setLayers] = useState<LayerData[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [containerKey, setContainerKey] = useState(0) // Force fresh container on each open
  const [showLayerPanel, setShowLayerPanel] = useState(false)

  const isOpen = activeDialog === 'globe3d'

  // Reset container key when dialog opens to force fresh DOM element
  useEffect(() => {
    if (isOpen) {
      setContainerKey(prev => prev + 1)
    }
  }, [isOpen])

  // Theme colors
  const headerBg = 'linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)'
  const panelBg = useColorModeValue('white', 'gray.800')
  const layerPanelBg = useColorModeValue('gray.50', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  // Extract data from dialog
  const connectionId = dialogData?.data?.connectionId as string
  const workspace = dialogData?.data?.workspace as string
  const layerName = dialogData?.data?.name as string
  const nodeType = dialogData?.data?.type as string

  // Build Terria catalog URL
  const getCatalogUrl = useCallback(() => {
    if (!connectionId || !workspace) return null

    if (nodeType === 'layergroup') {
      return `/api/terria/story/${connectionId}/${workspace}/${layerName}`
    }
    return `/api/terria/layer/${connectionId}/${workspace}/${layerName}`
  }, [connectionId, workspace, layerName, nodeType])

  // Initialize Cesium viewer
  useEffect(() => {
    if (!isOpen || !containerRef.current) return

    // Clean up any existing viewer first
    if (viewerRef.current) {
      try {
        viewerRef.current.destroy()
      } catch (e) {
        console.warn('[Globe3D] Error destroying previous viewer:', e)
      }
      viewerRef.current = null
    }

    setIsLoading(true)
    setError(null)
    let isMounted = true

    // Small delay to ensure container is ready
    const initTimer = setTimeout(async () => {
      if (!isMounted || !containerRef.current) return

      try {
        console.log('[Globe3D] Initializing Cesium viewer...')

        // Create viewer with minimal options
        const viewer = new Cesium.Viewer(containerRef.current!, {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          animation: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          vrButton: false,
          infoBox: false,
          creditContainer: document.createElement('div'), // Hide credits
        })

        // Remove any default imagery and terrain (no Ion required)
        viewer.imageryLayers.removeAll()
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()

        console.log('[Globe3D] Viewer created, adding base layer...')

        // Add CartoDB Positron as base layer (CORS-friendly, light theme)
        viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            subdomains: ['a', 'b', 'c', 'd'],
            credit: new Cesium.Credit('Map tiles by CartoDB, under CC BY 3.0. Data by OpenStreetMap, under ODbL.'),
          })
        )

        console.log('[Globe3D] CartoDB base layer added')

        viewerRef.current = viewer

        // Fetch catalog data and add layers
        const catalogUrl = getCatalogUrl()
        if (catalogUrl) {
          const response = await fetch(catalogUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch catalog: ${response.status}`)
          }
          const catalogData = await response.json()

          // Process catalog data
          const addedLayers: LayerData[] = []

          const processItem = (item: Record<string, unknown>) => {
            if (item.type === 'wms') {
              try {
                const provider = new Cesium.WebMapServiceImageryProvider({
                  url: item.url as string,
                  layers: (item.layers as string) || (item.name as string),
                  parameters: {
                    transparent: true,
                    format: 'image/png',
                  },
                })

                const layer = viewer.imageryLayers.addImageryProvider(provider)
                layer.alpha = (item.opacity as number) || 1.0

                addedLayers.push({
                  name: item.name as string,
                  layer,
                  visible: true,
                  opacity: layer.alpha,
                })

                // Fly to bounds if available
                if (item.rectangle) {
                  const rect = item.rectangle as { west: number; south: number; east: number; north: number }
                  viewer.camera.flyTo({
                    destination: Cesium.Rectangle.fromDegrees(
                      rect.west,
                      rect.south,
                      rect.east,
                      rect.north
                    ),
                    duration: 1.5,
                  })
                }
              } catch (e) {
                console.error('Failed to add WMS layer:', item.name, e)
              }
            } else if (item.type === 'group' && Array.isArray(item.members)) {
              item.members.forEach((member) => processItem(member as Record<string, unknown>))
            }
          }

          // Handle different catalog formats
          if (catalogData.catalog) {
            catalogData.catalog.forEach((item: Record<string, unknown>) => processItem(item))
          } else if (catalogData.type === 'wms') {
            processItem(catalogData)
          } else if (catalogData.type === 'group') {
            processItem(catalogData)
          }

          if (isMounted) setLayers(addedLayers)
        }

        if (isMounted) setIsLoading(false)
      } catch (e) {
        console.error('Failed to initialize Cesium viewer:', e)
        if (isMounted) {
          setError(e instanceof Error ? e.message : 'Failed to initialize viewer')
          setIsLoading(false)
        }
      }
    }, 200) // Slightly longer delay

    return () => {
      isMounted = false
      clearTimeout(initTimer)
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy()
        } catch (e) {
          console.warn('[Globe3D] Error destroying viewer:', e)
        }
        viewerRef.current = null
      }
      setLayers([])
    }
  }, [isOpen, getCatalogUrl, containerKey])

  // Handle view mode changes
  useEffect(() => {
    if (!viewerRef.current) return

    switch (viewMode) {
      case '3d':
        viewerRef.current.scene.mode = Cesium.SceneMode.SCENE3D
        break
      case '2d':
        viewerRef.current.scene.mode = Cesium.SceneMode.SCENE2D
        break
      case 'columbus':
        viewerRef.current.scene.mode = Cesium.SceneMode.COLUMBUS_VIEW
        break
    }
  }, [viewMode])

  const handleLayerVisibility = (index: number, visible: boolean) => {
    if (layers[index]) {
      layers[index].layer.show = visible
      setLayers(prev => prev.map((l, i) =>
        i === index ? { ...l, visible } : l
      ))
    }
  }

  const handleLayerOpacity = (index: number, opacity: number) => {
    if (layers[index]) {
      layers[index].layer.alpha = opacity
      setLayers(prev => prev.map((l, i) =>
        i === index ? { ...l, opacity } : l
      ))
    }
  }

  const handleRefresh = () => {
    if (!viewerRef.current) return

    // Force refresh all imagery layers
    const viewer = viewerRef.current
    const imageryLayers = viewer.imageryLayers

    for (let i = 0; i < imageryLayers.length; i++) {
      const layer = imageryLayers.get(i)
      // Toggle visibility to force refresh
      const wasVisible = layer.show
      layer.show = false
      setTimeout(() => { layer.show = wasVisible }, 100)
    }
  }

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev)
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeDialog}
      size={isFullscreen ? 'full' : '6xl'}
      isCentered={!isFullscreen}
    >
      <ModalOverlay bg="blackAlpha.700" />
      <ModalContent
        bg={panelBg}
        maxH={isFullscreen ? '100vh' : '90vh'}
        h={isFullscreen ? '100vh' : '85vh'}
        overflow="hidden"
      >
        {/* Header - matches MapPreview style */}
        <ModalHeader
          bg={headerBg}
          color="white"
          py={3}
          borderTopRadius={isFullscreen ? 0 : 'md'}
        >
          <HStack justify="space-between">
            <VStack align="start" spacing={0}>
              <HStack>
                <Icon as={FiGlobe} />
                <Text fontWeight="bold">3D Globe Viewer</Text>
                <Badge colorScheme="whiteAlpha" variant="solid" fontSize="xs">
                  {nodeType === 'layergroup' ? 'Layer Group' : 'Layer'}
                </Badge>
              </HStack>
              <Text fontSize="xs" color="whiteAlpha.800">
                {workspace}:{layerName}
              </Text>
            </VStack>
            <HStack spacing={2}>
              {/* Layer Picker Dropdown - like Style picker in MapPreview */}
              {layers.length > 0 && (
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
                    leftIcon={<FiLayers />}
                    maxW="180px"
                  >
                    <Text isTruncated fontSize="xs">
                      {layers.length} Layer{layers.length !== 1 ? 's' : ''}
                    </Text>
                  </MenuButton>
                  <MenuList color="gray.800" zIndex={1000} maxH="300px" overflowY="auto">
                    {layers.map((layer, index) => (
                      <MenuItem
                        key={index}
                        onClick={() => handleLayerVisibility(index, !layer.visible)}
                        closeOnSelect={false}
                      >
                        <HStack justify="space-between" w="100%">
                          <HStack>
                            <Icon as={layer.visible ? FiEye : FiEyeOff} color={layer.visible ? 'green.500' : 'gray.400'} />
                            <Text fontSize="sm">{layer.name}</Text>
                          </HStack>
                          <Badge colorScheme={layer.visible ? 'green' : 'gray'} size="sm">
                            {Math.round(layer.opacity * 100)}%
                          </Badge>
                        </HStack>
                      </MenuItem>
                    ))}
                  </MenuList>
                </Menu>
              )}

              {/* View Mode Toggle */}
              <ButtonGroup size="sm" isAttached variant="ghost">
                <Tooltip label="3D Globe">
                  <IconButton
                    aria-label="3D Globe"
                    icon={<FiGlobe />}
                    color="white"
                    bg={viewMode === '3d' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => setViewMode('3d')}
                  />
                </Tooltip>
                <Tooltip label="2D Map">
                  <IconButton
                    aria-label="2D Map"
                    icon={<FiMap />}
                    color="white"
                    bg={viewMode === '2d' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => setViewMode('2d')}
                  />
                </Tooltip>
                <Tooltip label="Columbus View">
                  <IconButton
                    aria-label="Columbus View"
                    icon={<FiBox />}
                    color="white"
                    bg={viewMode === 'columbus' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => setViewMode('columbus')}
                  />
                </Tooltip>
              </ButtonGroup>

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
              <Tooltip label="Layer Controls">
                <IconButton
                  aria-label="Layer Controls"
                  icon={<FiInfo />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={() => setShowLayerPanel(!showLayerPanel)}
                  bg={showLayerPanel ? 'whiteAlpha.200' : undefined}
                />
              </Tooltip>
              <Tooltip label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
                <IconButton
                  aria-label="Fullscreen"
                  icon={<FiMaximize2 />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={toggleFullscreen}
                />
              </Tooltip>
            </HStack>
          </HStack>
        </ModalHeader>
        <ModalCloseButton color="white" />

        <ModalBody p={0} display="flex" flexDirection="column" h="calc(100% - 60px)">
          {/* Collapsible Layer Panel - matches MapPreview metadata panel style */}
          <Collapse in={showLayerPanel} animateOpacity>
            <Box bg={layerPanelBg} p={4} borderBottom="1px solid" borderColor={borderColor}>
              {isLoading ? (
                <HStack justify="center" py={4}>
                  <Spinner size="sm" color="kartoza.500" />
                  <Text fontSize="sm" color="gray.500">Loading layers...</Text>
                </HStack>
              ) : layers.length > 0 ? (
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  {layers.map((layer, index) => (
                    <Box
                      key={index}
                      bg={panelBg}
                      p={3}
                      borderRadius="md"
                      border="1px solid"
                      borderColor={borderColor}
                    >
                      <HStack justify="space-between" mb={2}>
                        <HStack>
                          <IconButton
                            aria-label="Toggle visibility"
                            icon={layer.visible ? <FiEye /> : <FiEyeOff />}
                            size="xs"
                            variant="ghost"
                            colorScheme={layer.visible ? 'green' : 'gray'}
                            onClick={() => handleLayerVisibility(index, !layer.visible)}
                          />
                          <Text fontSize="sm" fontWeight="500" noOfLines={1}>
                            {layer.name}
                          </Text>
                        </HStack>
                      </HStack>
                      <HStack spacing={2}>
                        <Text fontSize="xs" color="gray.500" minW="50px">
                          Opacity
                        </Text>
                        <Slider
                          value={layer.opacity * 100}
                          onChange={(val) => handleLayerOpacity(index, val / 100)}
                          min={0}
                          max={100}
                          size="sm"
                        >
                          <SliderTrack bg="gray.200">
                            <SliderFilledTrack bg="kartoza.500" />
                          </SliderTrack>
                          <SliderThumb boxSize={3} />
                        </Slider>
                        <Text fontSize="xs" color="gray.500" minW="30px">
                          {Math.round(layer.opacity * 100)}%
                        </Text>
                      </HStack>
                    </Box>
                  ))}
                </SimpleGrid>
              ) : (
                <Text fontSize="sm" color="gray.500">No layers loaded</Text>
              )}
            </Box>
          </Collapse>

          {/* Map Container */}
          <Box flex="1" position="relative" bg="gray.900">
            <Box
              key={`cesium-container-${containerKey}`}
              ref={containerRef}
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
            />

            {isLoading && (
              <Box
                position="absolute"
                top="50%"
                left="50%"
                transform="translate(-50%, -50%)"
                textAlign="center"
                bg="blackAlpha.700"
                p={6}
                borderRadius="lg"
              >
                <Spinner size="xl" color="kartoza.400" thickness="4px" />
                <Text mt={3} color="white">Loading 3D viewer...</Text>
              </Box>
            )}

            {error && (
              <Box
                position="absolute"
                top="50%"
                left="50%"
                transform="translate(-50%, -50%)"
                textAlign="center"
                bg="red.600"
                color="white"
                p={6}
                borderRadius="lg"
                maxW="400px"
              >
                <Text fontWeight="bold" mb={2}>Error</Text>
                <Text fontSize="sm">{error}</Text>
              </Box>
            )}
          </Box>
        </ModalBody>

        {/* Footer */}
        <Box
          px={4}
          py={2}
          bg={layerPanelBg}
          borderTop="1px solid"
          borderColor={borderColor}
        >
          <HStack justify="space-between" fontSize="xs" color="gray.500">
            <Text>
              Connection: {connectionId?.slice(0, 8)}...
            </Text>
            <HStack spacing={4}>
              <Badge colorScheme={viewMode === '3d' ? 'green' : viewMode === '2d' ? 'blue' : 'purple'}>
                {viewMode === '3d' ? '3D Globe' : viewMode === '2d' ? '2D Map' : 'Columbus View'}
              </Badge>
              <Text>Scroll to zoom, drag to pan, right-drag to rotate</Text>
            </HStack>
          </HStack>
        </Box>
      </ModalContent>
    </Modal>
  )
}

export default Globe3DDialog

import {
  Box,
  Card,
  CardBody,
  Heading,
  Text,
  VStack,
  HStack,
  Badge,
  Divider,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Button,
  useColorModeValue,
  useDisclosure,
  Icon,
  Flex,
  Spacer,
  Spinner,
  Center,
  Progress,
  Wrap,
  WrapItem,
  Tag,
  Tooltip,
} from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import {
  FiServer,
  FiLayers,
  FiDatabase,
  FiPlus,
  FiFolder,
  FiImage,
  FiEdit3,
  FiMap,
  FiGrid,
  FiUpload,
  FiEye,
  FiSettings,
  FiDroplet,
  FiUsers,
  FiActivity,
  FiClock,
  FiZap,
  FiHardDrive,
  FiTable,
  FiCode,
  FiGlobe,
  FiMapPin,
  FiCheckCircle,
  FiAlertCircle,
} from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import { useEffect, useRef, useState, useMemo } from 'react'
import { useTreeStore } from '../stores/treeStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api/client'
import { useUIStore } from '../stores/uiStore'
import MapPreview from './MapPreview'
import Globe3DPreview from './Globe3DPreview'
import { SettingsDialog } from './dialogs/SettingsDialog'
import Dashboard from './Dashboard'

export default function MainContent() {
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const activePreview = useUIStore((state) => state.activePreview)
  const previewMode = useUIStore((state) => state.previewMode)
  const setPreview = useUIStore((state) => state.setPreview)
  const prevSelectedNodeRef = useRef(selectedNode)

  // Auto-update preview when selection changes to a previewable entity
  useEffect(() => {
    const prevNode = prevSelectedNodeRef.current
    prevSelectedNodeRef.current = selectedNode

    // Only auto-update if preview is currently active
    if (!activePreview || !selectedNode) return

    // Skip if the selection hasn't actually changed
    if (prevNode?.id === selectedNode.id) return

    // Check if the newly selected node is previewable
    const previewableTypes = ['layer', 'layergroup', 'datastore', 'coveragestore']
    if (!previewableTypes.includes(selectedNode.type)) return

    // Auto-start preview for the newly selected node
    const startAutoPreview = async () => {
      try {
        const layerType =
          selectedNode.type === 'coveragestore' ? 'raster' :
          selectedNode.type === 'layergroup' ? 'group' : 'vector'

        const { url } = await api.startPreview({
          connId: selectedNode.connectionId!,
          workspace: selectedNode.workspace!,
          layerName: selectedNode.name,
          storeName: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.name : undefined,
          storeType: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.type : undefined,
          layerType,
        })
        setPreview({
          url,
          layerName: selectedNode.name,
          workspace: selectedNode.workspace!,
          connectionId: selectedNode.connectionId!,
          storeName: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.name : undefined,
          storeType: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.type : undefined,
          layerType,
        })
      } catch (err) {
        useUIStore.getState().setError((err as Error).message)
      }
    }

    startAutoPreview()
  }, [selectedNode, activePreview, setPreview])

  // Show preview if active - fills the entire available space
  // Using key prop to force remount when layer changes, ensuring iframe and metadata fully refresh
  if (activePreview) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        {previewMode === '3d' ? (
          <Globe3DPreview
            key={`3d-${activePreview.workspace}:${activePreview.layerName}`}
            connectionId={activePreview.connectionId}
            workspace={activePreview.workspace}
            layerName={activePreview.layerName}
            nodeType={activePreview.nodeType || (activePreview.layerType === 'group' ? 'layergroup' : 'layer')}
            onClose={() => setPreview(null)}
          />
        ) : (
          <MapPreview
            key={`2d-${activePreview.workspace}:${activePreview.layerName}:${activePreview.url}`}
            previewUrl={activePreview.url}
            layerName={activePreview.layerName}
            workspace={activePreview.workspace}
            connectionId={activePreview.connectionId}
            storeName={activePreview.storeName}
            storeType={activePreview.storeType}
            layerType={activePreview.layerType}
            onClose={() => setPreview(null)}
          />
        )}
      </Box>
    )
  }

  if (!selectedNode) {
    return <Dashboard />
  }

  switch (selectedNode.type) {
    case 'connection':
      return <ConnectionPanel connectionId={selectedNode.connectionId!} />
    case 'workspace':
      return (
        <WorkspacePanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'datastores':
      return (
        <DataStoresDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'coveragestores':
      return (
        <CoverageStoresDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'layers':
      return (
        <LayersDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'styles':
      return (
        <StylesDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'layergroups':
      return (
        <LayerGroupsDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'datastore':
    case 'coveragestore':
      return (
        <StorePanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          storeName={selectedNode.name}
          storeType={selectedNode.type}
        />
      )
    case 'layer':
      return (
        <LayerPanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          layerName={selectedNode.name}
        />
      )
    case 'style':
      return (
        <StylePanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          styleName={selectedNode.name}
        />
      )
    case 'layergroup':
      return (
        <LayerGroupPanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          groupName={selectedNode.name}
        />
      )
    case 'pgservice':
      return (
        <PGServicePanel serviceName={selectedNode.serviceName!} />
      )
    case 'pgschema':
      return (
        <PGSchemaPanel
          serviceName={selectedNode.serviceName!}
          schemaName={selectedNode.schemaName!}
        />
      )
    default:
      return <Dashboard />
  }
}

// Dashboard for Data Stores
function DataStoresDashboard({
  connectionId,
  workspace,
}: {
  connectionId: string
  workspace: string
}) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: datastores } = useQuery({
    queryKey: ['datastores', connectionId, workspace],
    queryFn: () => api.getDataStores(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      {/* Dashboard Header */}
      <Card
        bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiDatabase} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg">Data Stores</Heading>
                <Text opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{datastores?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Stores</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      {/* Action Buttons */}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus />}
          onClick={() => openDialog('datastore', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
        >
          Create New Data Store
        </Button>
        <Button
          size="lg"
          variant="outline"
          leftIcon={<FiUpload />}
          onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
        >
          Upload Shapefile / GeoPackage
        </Button>
      </SimpleGrid>

      {/* Store List */}
      {datastores && datastores.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Data Stores</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {datastores.map((store) => (
                  <StoreCard
                    key={store.name}
                    name={store.name}
                    type={store.type || 'Unknown'}
                    enabled={store.enabled}
                    icon={FiDatabase}
                    connectionId={connectionId}
                    workspace={workspace}
                    storeType="datastore"
                  />
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// Dashboard for Coverage Stores
function CoverageStoresDashboard({
  connectionId,
  workspace,
}: {
  connectionId: string
  workspace: string
}) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: coveragestores } = useQuery({
    queryKey: ['coveragestores', connectionId, workspace],
    queryFn: () => api.getCoverageStores(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="linear-gradient(135deg, #D4922A 0%, #E8A331 50%, #F0B84D 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiImage} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg">Coverage Stores</Heading>
                <Text opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{coveragestores?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Stores</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus />}
          onClick={() => openDialog('coveragestore', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
        >
          Create New Coverage Store
        </Button>
        <Button
          size="lg"
          variant="outline"
          leftIcon={<FiUpload />}
          onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
        >
          Upload GeoTIFF
        </Button>
      </SimpleGrid>

      {coveragestores && coveragestores.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Coverage Stores</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {coveragestores.map((store) => (
                  <StoreCard
                    key={store.name}
                    name={store.name}
                    type={store.type || 'GeoTIFF'}
                    enabled={store.enabled}
                    icon={FiImage}
                    connectionId={connectionId}
                    workspace={workspace}
                    storeType="coveragestore"
                  />
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// Dashboard for Layers
function LayersDashboard({
  connectionId,
  workspace,
}: {
  connectionId: string
  workspace: string
}) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: layers } = useQuery({
    queryKey: ['layers', connectionId, workspace],
    queryFn: () => api.getLayers(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiLayers} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg">Layers</Heading>
                <Text opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{layers?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Published Layers</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <Button
        size="lg"
        variant="accent"
        leftIcon={<FiUpload />}
        onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
        py={8}
      >
        Upload New Layer Data
      </Button>

      {layers && layers.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Published Layers</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {layers.map((layer) => (
                  <LayerCard
                    key={layer.name}
                    name={layer.name}
                    connectionId={connectionId}
                    workspace={workspace}
                    enabled={layer.enabled}
                  />
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// Style Legend Preview component
// GeoServer's GetLegendGraphic requires a LAYER parameter, so we need to find
// a layer that uses this style. We'll query the layers and find one using this style.
function StyleLegendPreview({
  connectionId,
  workspace,
  styleName,
  size = 24
}: {
  connectionId: string
  workspace: string
  styleName: string
  size?: number
}) {
  const [hasError, setHasError] = useState(false)
  const connections = useConnectionStore((state) => state.connections)
  const connection = connections.find((c) => c.id === connectionId)

  // Find a layer that uses this style
  const { data: layers } = useQuery({
    queryKey: ['layers', connectionId, workspace],
    queryFn: () => api.getLayers(connectionId, workspace),
    staleTime: 60000,
  })

  // Find a layer that has this style as default style
  const layerWithStyle = layers?.find(layer => layer.defaultStyle === styleName)

  if (!connection || hasError || !layerWithStyle) {
    return <Icon as={FiDroplet} color="pink.500" boxSize={`${size}px`} />
  }

  // Build the GeoServer base URL from connection URL (remove /rest suffix)
  const geoserverUrl = connection.url.replace(/\/rest\/?$/, '')
  // Use the layer we found with STYLE parameter to get the specific style's legend
  const legendUrl = `${geoserverUrl}/${workspace}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&LAYER=${workspace}:${layerWithStyle.name}&STYLE=${styleName}&FORMAT=image/png&WIDTH=${size}&HEIGHT=${size}&LEGEND_OPTIONS=forceLabels:off;fontAntiAliasing:true`

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

// Dashboard for Styles
function StylesDashboard({
  connectionId,
  workspace,
}: {
  connectionId: string
  workspace: string
}) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: styles } = useQuery({
    queryKey: ['styles', connectionId, workspace],
    queryFn: () => api.getStyles(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="linear-gradient(135deg, #5BB5E8 0%, #3B9DD9 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiEdit3} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg">Styles</Heading>
                <Text opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{styles?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Styles</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <HStack spacing={4}>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus />}
          onClick={() => openDialog('style', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
          flex={1}
        >
          Create Style
        </Button>
        <Button
          size="lg"
          variant="outline"
          leftIcon={<FiUpload />}
          onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
          flex={1}
        >
          Upload SLD / CSS
        </Button>
      </HStack>

      {styles && styles.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Styles</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {styles.map((style) => (
                  <Card
                    key={style.name}
                    variant="outline"
                    size="sm"
                    cursor="pointer"
                    _hover={{ shadow: 'md', borderColor: 'kartoza.300' }}
                    transition="all 0.2s"
                    onClick={() => openDialog('style', { mode: 'edit', data: { connectionId, workspace, name: style.name } })}
                  >
                    <CardBody py={3} px={4}>
                      <HStack>
                        <StyleLegendPreview
                          connectionId={connectionId}
                          workspace={workspace}
                          styleName={style.name}
                          size={24}
                        />
                        <Text fontWeight="medium">{style.name}</Text>
                        {style.format && (
                          <Badge colorScheme="blue" size="sm">{style.format}</Badge>
                        )}
                      </HStack>
                    </CardBody>
                  </Card>
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// Dashboard for Layer Groups
function LayerGroupsDashboard({
  connectionId,
  workspace,
}: {
  connectionId: string
  workspace: string
}) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: layergroups } = useQuery({
    queryKey: ['layergroups', connectionId, workspace],
    queryFn: () => api.getLayerGroups(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="linear-gradient(135deg, #1B6B9B 0%, #155a84 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiGrid} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg">Layer Groups</Heading>
                <Text opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{layergroups?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Groups</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <Button
        size="lg"
        variant="accent"
        leftIcon={<FiPlus />}
        py={8}
        onClick={() =>
          openDialog('layergroup', {
            mode: 'create',
            data: { connectionId, workspace },
          })
        }
      >
        Create Layer Group
      </Button>

      {layergroups && layergroups.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Layer Groups</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {layergroups.map((group) => (
                  <Card key={group.name} variant="outline" size="sm">
                    <CardBody py={3} px={4}>
                      <HStack>
                        <Icon as={FiGrid} color="kartoza.500" />
                        <Text fontWeight="medium">{group.name}</Text>
                        {group.mode && (
                          <Badge colorScheme="purple" size="sm">{group.mode}</Badge>
                        )}
                      </HStack>
                    </CardBody>
                  </Card>
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// Store Card Component
function StoreCard({
  name,
  type,
  enabled,
  icon,
  connectionId,
  workspace,
  storeType,
}: {
  name: string
  type: string
  enabled: boolean
  icon: React.ElementType
  connectionId: string
  workspace: string
  storeType: 'datastore' | 'coveragestore'
}) {
  const setPreview = useUIStore((state) => state.setPreview)

  const handlePreview = async () => {
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName: name,
        storeName: name,
        storeType,
        layerType: storeType === 'coveragestore' ? 'raster' : 'vector',
      })
      setPreview({
        url,
        layerName: name,
        workspace,
        connectionId,
        storeName: name,
        storeType,
        layerType: storeType === 'coveragestore' ? 'raster' : 'vector',
      })
    } catch (err) {
      useUIStore.getState().setError((err as Error).message)
    }
  }

  return (
    <Card variant="outline" size="sm" _hover={{ shadow: 'md' }} transition="all 0.2s">
      <CardBody py={4} px={4}>
        <VStack align="stretch" spacing={3}>
          <HStack justify="space-between">
            <HStack>
              <Icon as={icon} color="kartoza.500" boxSize={5} />
              <Text fontWeight="medium" noOfLines={1}>{name}</Text>
            </HStack>
            <Badge colorScheme={enabled ? 'green' : 'gray'} size="sm">
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </HStack>
          <Text fontSize="xs" color="gray.500">{type}</Text>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<FiEye />}
            onClick={handlePreview}
          >
            Preview
          </Button>
        </VStack>
      </CardBody>
    </Card>
  )
}

// Layer Card Component
function LayerCard({
  name,
  connectionId,
  workspace,
  enabled,
}: {
  name: string
  connectionId: string
  workspace: string
  enabled: boolean
}) {
  const setPreview = useUIStore((state) => state.setPreview)

  const { data: layer } = useQuery({
    queryKey: ['layer', connectionId, workspace, name],
    queryFn: () => api.getLayer(connectionId, workspace, name),
  })

  const handlePreview = async () => {
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName: name,
        storeName: layer?.store,
        storeType: layer?.storeType,
        layerType: layer?.storeType === 'coveragestore' ? 'raster' : 'vector',
      })
      setPreview({
        url,
        layerName: name,
        workspace,
        connectionId,
        storeName: layer?.store,
        storeType: layer?.storeType,
        layerType: layer?.storeType === 'coveragestore' ? 'raster' : 'vector',
      })
    } catch (err) {
      useUIStore.getState().setError((err as Error).message)
    }
  }

  return (
    <Card variant="outline" size="sm" _hover={{ shadow: 'md' }} transition="all 0.2s">
      <CardBody py={4} px={4}>
        <VStack align="stretch" spacing={3}>
          <HStack justify="space-between">
            <HStack>
              <Icon as={FiLayers} color="kartoza.500" boxSize={5} />
              <Text fontWeight="medium" noOfLines={1}>{name}</Text>
            </HStack>
            <Badge colorScheme={enabled ? 'green' : 'gray'} size="sm">
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </HStack>
          {layer?.defaultStyle && (
            <Text fontSize="xs" color="gray.500">Style: {layer.defaultStyle}</Text>
          )}
          <Button
            size="sm"
            colorScheme="kartoza"
            leftIcon={<FiMap />}
            onClick={handlePreview}
          >
            Preview on Map
          </Button>
        </VStack>
      </CardBody>
    </Card>
  )
}

// Connection Panel
function ConnectionPanel({ connectionId }: { connectionId: string }) {
  const connections = useConnectionStore((state) => state.connections)
  const connection = connections.find((c) => c.id === connectionId)
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')
  const settingsDisclosure = useDisclosure()

  const { data: serverInfo } = useQuery({
    queryKey: ['serverInfo', connectionId],
    queryFn: () => api.getServerInfo(connectionId),
  })

  const { data: workspaces } = useQuery({
    queryKey: ['workspaces', connectionId],
    queryFn: () => api.getWorkspaces(connectionId),
  })

  if (!connection) return null

  return (
    <VStack spacing={6} align="stretch">
      {/* Connection Header */}
      <Card
        bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiServer} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg">{connection.name}</Heading>
                <Text opacity={0.9}>{connection.url}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <HStack>
              <Button
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiSettings />}
                onClick={settingsDisclosure.onOpen}
              >
                Service Metadata
              </Button>
              <Badge colorScheme="green" fontSize="md" px={4} py={2}>
                Connected
              </Badge>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={settingsDisclosure.isOpen}
        onClose={settingsDisclosure.onClose}
        connectionId={connectionId}
        connectionName={connection.name}
      />

      {/* Stats */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
        <Card bg={cardBg}>
          <CardBody>
            <Stat>
              <StatLabel>Workspaces</StatLabel>
              <StatNumber color="kartoza.700">{workspaces?.length ?? 0}</StatNumber>
              <StatHelpText>Total workspaces</StatHelpText>
            </Stat>
          </CardBody>
        </Card>
        {serverInfo && (
          <>
            <Card bg={cardBg}>
              <CardBody>
                <Stat>
                  <StatLabel>GeoServer</StatLabel>
                  <StatNumber color="kartoza.700" fontSize="xl">{serverInfo.GeoServerVersion}</StatNumber>
                  <StatHelpText>Version</StatHelpText>
                </Stat>
              </CardBody>
            </Card>
            <Card bg={cardBg}>
              <CardBody>
                <Stat>
                  <StatLabel>GeoTools</StatLabel>
                  <StatNumber color="kartoza.700" fontSize="xl">{serverInfo.GeoToolsVersion}</StatNumber>
                  <StatHelpText>Version</StatHelpText>
                </Stat>
              </CardBody>
            </Card>
          </>
        )}
      </SimpleGrid>

      {/* Actions */}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus />}
          onClick={() => openDialog('workspace', { mode: 'create', data: { connectionId } })}
          py={8}
        >
          Create New Workspace
        </Button>
        <Button
          size="lg"
          variant="outline"
          leftIcon={<FiUpload />}
          onClick={() => openDialog('upload', { mode: 'create' })}
          py={8}
        >
          Upload Data
        </Button>
      </SimpleGrid>
    </VStack>
  )
}

// Workspace Panel
function WorkspacePanel({
  connectionId,
  workspace,
}: {
  connectionId: string
  workspace: string
}) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: config } = useQuery({
    queryKey: ['workspace', connectionId, workspace],
    queryFn: () => api.getWorkspace(connectionId, workspace),
  })

  const { data: datastores } = useQuery({
    queryKey: ['datastores', connectionId, workspace],
    queryFn: () => api.getDataStores(connectionId, workspace),
  })

  const { data: coveragestores } = useQuery({
    queryKey: ['coveragestores', connectionId, workspace],
    queryFn: () => api.getCoverageStores(connectionId, workspace),
  })

  const { data: layers } = useQuery({
    queryKey: ['layers', connectionId, workspace],
    queryFn: () => api.getLayers(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      {/* Workspace Header */}
      <Card
        bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiFolder} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg">{workspace}</Heading>
                <HStack>
                  {config?.default && <Badge colorScheme="blue">Default</Badge>}
                  {config?.isolated && <Badge colorScheme="purple">Isolated</Badge>}
                  {config?.enabled && <Badge colorScheme="green">Enabled</Badge>}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <Button
              variant="outline"
              color="white"
              borderColor="whiteAlpha.400"
              _hover={{ bg: 'whiteAlpha.200' }}
              onClick={() => openDialog('workspace', { mode: 'edit', data: { connectionId, workspace } })}
            >
              Edit Workspace
            </Button>
          </Flex>
        </CardBody>
      </Card>

      {/* Stats Grid */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
        <Card bg={cardBg} variant="elevated" cursor="pointer">
          <CardBody>
            <Stat>
              <HStack>
                <Icon as={FiDatabase} color="kartoza.500" boxSize={6} />
                <StatLabel>Data Stores</StatLabel>
              </HStack>
              <StatNumber color="kartoza.700">{datastores?.length ?? 0}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card bg={cardBg} variant="elevated" cursor="pointer">
          <CardBody>
            <Stat>
              <HStack>
                <Icon as={FiImage} color="accent.400" boxSize={6} />
                <StatLabel>Coverage Stores</StatLabel>
              </HStack>
              <StatNumber color="kartoza.700">{coveragestores?.length ?? 0}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card bg={cardBg} variant="elevated" cursor="pointer">
          <CardBody>
            <Stat>
              <HStack>
                <Icon as={FiLayers} color="kartoza.500" boxSize={6} />
                <StatLabel>Layers</StatLabel>
              </HStack>
              <StatNumber color="kartoza.700">{layers?.length ?? 0}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Quick Actions */}
      <Card bg={cardBg}>
        <CardBody>
          <VStack align="stretch" spacing={4}>
            <Heading size="sm" color="gray.600">Quick Actions</Heading>
            <Divider />
            <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
              <Button
                variant="accent"
                leftIcon={<FiUpload />}
                onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
              >
                Upload Data
              </Button>
              <Button
                variant="outline"
                leftIcon={<FiPlus />}
                onClick={() => openDialog('datastore', { mode: 'create', data: { connectionId, workspace } })}
              >
                New Data Store
              </Button>
              <Button
                variant="outline"
                leftIcon={<FiPlus />}
                onClick={() => openDialog('coveragestore', { mode: 'create', data: { connectionId, workspace } })}
              >
                New Coverage Store
              </Button>
            </SimpleGrid>
          </VStack>
        </CardBody>
      </Card>

      {/* OGC Services */}
      {config && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="start" spacing={3}>
              <Heading size="sm" color="gray.600">OGC Services</Heading>
              <Divider />
              <HStack wrap="wrap" gap={2}>
                <Badge colorScheme={config.wmsEnabled ? 'green' : 'gray'} px={3} py={1}>WMS</Badge>
                <Badge colorScheme={config.wfsEnabled ? 'green' : 'gray'} px={3} py={1}>WFS</Badge>
                <Badge colorScheme={config.wcsEnabled ? 'green' : 'gray'} px={3} py={1}>WCS</Badge>
                <Badge colorScheme={config.wmtsEnabled ? 'green' : 'gray'} px={3} py={1}>WMTS</Badge>
                <Badge colorScheme={config.wpsEnabled ? 'green' : 'gray'} px={3} py={1}>WPS</Badge>
              </HStack>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// Store Panel
function StorePanel({
  connectionId,
  workspace,
  storeName,
  storeType,
}: {
  connectionId: string
  workspace: string
  storeName: string
  storeType: 'datastore' | 'coveragestore'
}) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const setPreview = useUIStore((state) => state.setPreview)
  const openDialog = useUIStore((state) => state.openDialog)

  const isDataStore = storeType === 'datastore'

  const { data: store } = useQuery({
    queryKey: [storeType + 's', connectionId, workspace, storeName],
    queryFn: () =>
      isDataStore
        ? api.getDataStore(connectionId, workspace, storeName)
        : api.getCoverageStore(connectionId, workspace, storeName),
  })

  const handlePreview = async () => {
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName: storeName,
        storeName,
        storeType,
        layerType: isDataStore ? 'vector' : 'raster',
      })
      setPreview({
        url,
        layerName: storeName,
        workspace,
        connectionId,
        storeName,
        storeType,
        layerType: isDataStore ? 'vector' : 'raster',
      })
    } catch (err) {
      useUIStore.getState().setError((err as Error).message)
    }
  }

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg={isDataStore
          ? "linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
          : "linear-gradient(135deg, #D4922A 0%, #E8A331 100%)"
        }
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={isDataStore ? FiDatabase : FiImage} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg">{storeName}</Heading>
                <HStack>
                  <Badge colorScheme={isDataStore ? 'blue' : 'orange'}>
                    {isDataStore ? 'Data Store' : 'Coverage Store'}
                  </Badge>
                  {store?.enabled && <Badge colorScheme="green">Enabled</Badge>}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <HStack wrap="wrap" gap={2}>
              <Button
                variant="solid"
                bg="whiteAlpha.200"
                color="white"
                _hover={{ bg: 'whiteAlpha.300' }}
                leftIcon={<FiMap />}
                onClick={handlePreview}
              >
                Preview on Map
              </Button>
              <Button
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiEdit3 />}
                onClick={() => openDialog(storeType, {
                  mode: 'edit',
                  data: { connectionId, workspace, storeName }
                })}
              >
                Edit Store
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      <Card bg={cardBg}>
        <CardBody>
          <VStack align="start" spacing={3}>
            <Heading size="sm" color="gray.600">Store Details</Heading>
            <Divider />
            <SimpleGrid columns={2} spacing={4} w="100%">
              <Box>
                <Text fontSize="xs" color="gray.500">Workspace</Text>
                <Text fontWeight="medium">{workspace}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" color="gray.500">Type</Text>
                <Text fontWeight="medium">{store?.type || 'Unknown'}</Text>
              </Box>
            </SimpleGrid>
          </VStack>
        </CardBody>
      </Card>
    </VStack>
  )
}

// Layer Panel
function LayerPanel({
  connectionId,
  workspace,
  layerName,
}: {
  connectionId: string
  workspace: string
  layerName: string
}) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const setPreview = useUIStore((state) => state.setPreview)
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: layer } = useQuery({
    queryKey: ['layer', connectionId, workspace, layerName],
    queryFn: () => api.getLayer(connectionId, workspace, layerName),
  })

  const handlePreview = async () => {
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName,
        storeName: layer?.store,
        storeType: layer?.storeType,
        layerType: layer?.storeType === 'coveragestore' ? 'raster' : 'vector',
      })
      setPreview({
        url,
        layerName,
        workspace,
        connectionId,
        storeName: layer?.store,
        storeType: layer?.storeType,
        layerType: layer?.storeType === 'coveragestore' ? 'raster' : 'vector',
      })
    } catch (err) {
      useUIStore.getState().setError((err as Error).message)
    }
  }

  const handleManageCache = () => {
    openDialog('info', {
      mode: 'view',
      title: 'Tile Cache',
      data: {
        connectionId,
        workspace,
        layerName,
      },
    })
  }

  const handlePreviewCache = async () => {
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName,
        storeName: layer?.store,
        storeType: layer?.storeType,
        layerType: layer?.storeType === 'coveragestore' ? 'raster' : 'vector',
        useCache: true,
        gridSet: 'EPSG:900913',
        tileFormat: 'image/png',
      })
      setPreview({
        url,
        layerName,
        workspace,
        connectionId,
        storeName: layer?.store,
        storeType: layer?.storeType,
        layerType: layer?.storeType === 'coveragestore' ? 'raster' : 'vector',
      })
    } catch (err) {
      useUIStore.getState().setError((err as Error).message)
    }
  }

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiLayers} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg">{layerName}</Heading>
                <HStack>
                  <Badge colorScheme="teal">Layer</Badge>
                  {layer?.enabled && <Badge colorScheme="green">Enabled</Badge>}
                  {layer?.advertised && <Badge colorScheme="blue">Advertised</Badge>}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <HStack wrap="wrap" gap={2}>
              <Button
                size="lg"
                variant="accent"
                leftIcon={<FiMap />}
                onClick={handlePreview}
              >
                Preview (WMS)
              </Button>
              <Button
                size="lg"
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiMap />}
                onClick={handlePreviewCache}
              >
                Preview Cache
              </Button>
              <Button
                size="lg"
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiDatabase />}
                onClick={handleManageCache}
              >
                Manage Cache
              </Button>
              <Button
                size="lg"
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiEdit3 />}
                onClick={() => openDialog('layer', {
                  mode: 'edit',
                  data: { connectionId, workspace, layerName }
                })}
              >
                Edit Layer
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      {layer && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="start" spacing={3}>
              <Heading size="sm" color="gray.600">Layer Configuration</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} w="100%">
                <Box>
                  <Text fontSize="xs" color="gray.500">Workspace</Text>
                  <Text fontWeight="medium">{workspace}</Text>
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.500">Store</Text>
                  <Text fontWeight="medium">{layer.store || 'Unknown'}</Text>
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.500">Store Type</Text>
                  <Text fontWeight="medium">{layer.storeType || 'Unknown'}</Text>
                </Box>
                <Box>
                  <Text fontSize="xs" color="gray.500">Default Style</Text>
                  <Text fontWeight="medium">{layer.defaultStyle || 'None'}</Text>
                </Box>
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}

      {/* Quick Actions Card */}
      <Card bg={cardBg}>
        <CardBody>
          <VStack align="stretch" spacing={4}>
            <Heading size="sm" color="gray.600">Tile Cache</Heading>
            <Divider />
            <Text fontSize="sm" color="gray.600">
              Manage tile cache for this layer. Seed tiles for faster map viewing,
              or truncate the cache to regenerate tiles.
            </Text>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
              <Button
                colorScheme="kartoza"
                leftIcon={<FiDatabase />}
                onClick={handleManageCache}
              >
                Seed / Truncate Cache
              </Button>
            </SimpleGrid>
          </VStack>
        </CardBody>
      </Card>
    </VStack>
  )
}

// Layer Group Panel
function LayerGroupPanel({
  connectionId,
  workspace,
  groupName,
}: {
  connectionId: string
  workspace: string
  groupName: string
}) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const setPreview = useUIStore((state) => state.setPreview)
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: group } = useQuery({
    queryKey: ['layergroup', connectionId, workspace, groupName],
    queryFn: () => api.getLayerGroup(connectionId, workspace, groupName),
  })

  const handlePreview = async () => {
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName: groupName,
        layerType: 'group',
      })
      setPreview({
        url,
        layerName: groupName,
        workspace,
        connectionId,
        layerType: 'group',
      })
    } catch (err) {
      useUIStore.getState().setError((err as Error).message)
    }
  }

  const handleManageCache = () => {
    openDialog('info', {
      mode: 'view',
      title: 'Tile Cache',
      data: {
        connectionId,
        workspace,
        layerName: groupName,
      },
    })
  }

  const handlePreviewCache = async () => {
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName: groupName,
        layerType: 'group',
        useCache: true,
        gridSet: 'EPSG:900913',
        tileFormat: 'image/png',
      })
      setPreview({
        url,
        layerName: groupName,
        workspace,
        connectionId,
        layerType: 'group',
      })
    } catch (err) {
      useUIStore.getState().setError((err as Error).message)
    }
  }

  const handleEditLayers = () => {
    openDialog('layergroup', {
      mode: 'edit',
      data: {
        connectionId,
        workspace,
        name: groupName,
        layers: group?.layers.map((l) => l.name) || [],
        mode: group?.mode,
        title: group?.title,
      },
    })
  }

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="linear-gradient(135deg, #1B6B9B 0%, #155a84 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiGrid} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg">{groupName}</Heading>
                <HStack>
                  <Badge colorScheme="purple">Layer Group</Badge>
                  {group?.mode && <Badge colorScheme="blue">{group.mode}</Badge>}
                  {group?.enabled && <Badge colorScheme="green">Enabled</Badge>}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <HStack wrap="wrap" gap={2}>
              <Button
                size="lg"
                variant="accent"
                leftIcon={<FiMap />}
                onClick={handlePreview}
              >
                Preview (WMS)
              </Button>
              <Button
                size="lg"
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiMap />}
                onClick={handlePreviewCache}
              >
                Preview Cache
              </Button>
              <Button
                size="lg"
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiDatabase />}
                onClick={handleManageCache}
              >
                Manage Cache
              </Button>
              <Button
                size="lg"
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiEdit3 />}
                onClick={handleEditLayers}
              >
                Edit Layers
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      {group && (
        <>
          {/* Group Configuration */}
          <Card bg={cardBg}>
            <CardBody>
              <VStack align="start" spacing={3}>
                <Heading size="sm" color="gray.600">Group Configuration</Heading>
                <Divider />
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} w="100%">
                  <Box>
                    <Text fontSize="xs" color="gray.500">Workspace</Text>
                    <Text fontWeight="medium">{workspace}</Text>
                  </Box>
                  <Box>
                    <Text fontSize="xs" color="gray.500">Mode</Text>
                    <Text fontWeight="medium">{group.mode || 'SINGLE'}</Text>
                  </Box>
                  {group.title && (
                    <Box>
                      <Text fontSize="xs" color="gray.500">Title</Text>
                      <Text fontWeight="medium">{group.title}</Text>
                    </Box>
                  )}
                  {group.bounds && (
                    <Box>
                      <Text fontSize="xs" color="gray.500">Bounds</Text>
                      <Text fontWeight="medium" fontSize="xs">
                        [{group.bounds.minX.toFixed(2)}, {group.bounds.minY.toFixed(2)}, {group.bounds.maxX.toFixed(2)}, {group.bounds.maxY.toFixed(2)}]
                      </Text>
                    </Box>
                  )}
                </SimpleGrid>
              </VStack>
            </CardBody>
          </Card>

          {/* Layers in Group */}
          <Card bg={cardBg}>
            <CardBody>
              <VStack align="stretch" spacing={3}>
                <Heading size="sm" color="gray.600">Layers in Group ({group.layers.length})</Heading>
                <Divider />
                <VStack align="stretch" spacing={2}>
                  {group.layers.map((layer, index) => (
                    <HStack key={index} p={2} bg="gray.50" borderRadius="md" _dark={{ bg: 'gray.700' }}>
                      <Badge colorScheme={layer.type === 'layer' ? 'teal' : 'purple'}>
                        {layer.type}
                      </Badge>
                      <Text fontWeight="medium">{layer.name}</Text>
                      {layer.styleName && (
                        <Text fontSize="sm" color="gray.500">
                          (Style: {layer.styleName})
                        </Text>
                      )}
                    </HStack>
                  ))}
                </VStack>
              </VStack>
            </CardBody>
          </Card>

          {/* Cache Management */}
          <Card bg={cardBg}>
            <CardBody>
              <VStack align="stretch" spacing={4}>
                <Heading size="sm" color="gray.600">Tile Cache</Heading>
                <Divider />
                <Text fontSize="sm" color="gray.600">
                  Manage tile cache for this layer group. Seed tiles for faster map viewing,
                  or truncate the cache to regenerate tiles.
                </Text>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <Button
                    colorScheme="kartoza"
                    leftIcon={<FiDatabase />}
                    onClick={handleManageCache}
                  >
                    Seed / Truncate Cache
                  </Button>
                  <Button
                    variant="outline"
                    leftIcon={<FiEdit3 />}
                    onClick={handleEditLayers}
                  >
                    Modify Layers
                  </Button>
                </SimpleGrid>
              </VStack>
            </CardBody>
          </Card>
        </>
      )}
    </VStack>
  )
}

// Style Panel
function StylePanel({
  connectionId,
  workspace,
  styleName,
}: {
  connectionId: string
  workspace: string
  styleName: string
}) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: styleContent } = useQuery({
    queryKey: ['style', connectionId, workspace, styleName],
    queryFn: () => api.getStyleContent(connectionId, workspace, styleName),
  })

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="linear-gradient(135deg, #3d9970 0%, #2d7a5a 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiEdit3} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg">{styleName}</Heading>
                <HStack>
                  <Badge colorScheme="pink">Style</Badge>
                  {styleContent?.format && (
                    <Badge colorScheme="blue">{styleContent.format.toUpperCase()}</Badge>
                  )}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <Button
              size="lg"
              variant="accent"
              leftIcon={<FiEdit3 />}
              onClick={() => openDialog('style', {
                mode: 'edit',
                data: { connectionId, workspace, name: styleName }
              })}
            >
              Edit Style
            </Button>
          </Flex>
        </CardBody>
      </Card>

      <Card bg={cardBg}>
        <CardBody>
          <VStack align="start" spacing={3}>
            <Heading size="sm" color="gray.600">Style Details</Heading>
            <Divider />
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} w="100%">
              <Box>
                <Text fontSize="xs" color="gray.500">Workspace</Text>
                <Text fontWeight="medium">{workspace}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" color="gray.500">Format</Text>
                <Text fontWeight="medium">{styleContent?.format?.toUpperCase() || 'Unknown'}</Text>
              </Box>
            </SimpleGrid>
          </VStack>
        </CardBody>
      </Card>

      {styleContent?.content && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={3}>
              <Heading size="sm" color="gray.600">Style Content Preview</Heading>
              <Divider />
              <Box
                bg="gray.50"
                _dark={{ bg: 'gray.900' }}
                p={4}
                borderRadius="md"
                maxH="400px"
                overflowY="auto"
                fontFamily="mono"
                fontSize="sm"
                whiteSpace="pre-wrap"
                wordBreak="break-all"
              >
                {styleContent.content.slice(0, 2000)}
                {styleContent.content.length > 2000 && '...\n[Content truncated - click Edit Style to see full content]'}
              </Box>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// Pulse animation for the map dot
const pulse = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(2);
    opacity: 0.5;
  }
  100% {
    transform: scale(3);
    opacity: 0;
  }
`

// Simplified world map paths (continent outlines)
const WORLD_MAP_PATH = `
  M 115 95 Q 120 80 140 75 Q 160 70 180 78 Q 200 85 210 95 Q 220 105 215 120
  Q 210 135 195 145 Q 180 155 160 160 Q 140 165 125 155 Q 110 145 105 130
  Q 100 115 115 95 Z
  M 125 170 Q 135 165 145 170 Q 155 175 160 190 Q 165 205 158 225
  Q 150 245 140 255 Q 130 265 120 260 Q 110 255 108 240 Q 105 225 110 205
  Q 115 185 125 170 Z
  M 440 70 Q 460 65 480 72 Q 500 80 510 95 Q 520 110 515 125
  Q 510 140 495 145 Q 480 150 460 145 Q 440 140 430 125 Q 420 110 425 90 Q 430 75 440 70 Z
  M 455 155 Q 475 150 495 158 Q 515 165 525 185 Q 535 205 530 230
  Q 525 255 510 270 Q 495 285 475 282 Q 455 280 445 265 Q 435 250 438 225
  Q 440 200 445 180 Q 450 160 455 155 Z
  M 550 60 Q 590 50 640 55 Q 690 60 730 80 Q 770 100 790 130
  Q 810 160 800 195 Q 790 230 760 250 Q 730 270 690 275 Q 650 280 610 270
  Q 570 260 545 235 Q 520 210 520 175 Q 520 140 530 110 Q 540 80 550 60 Z
  M 770 280 Q 790 275 810 285 Q 830 295 835 315 Q 840 335 830 350
  Q 820 365 800 368 Q 780 370 765 360 Q 750 350 752 330 Q 755 310 760 295 Q 765 285 770 280 Z
`

// Get location description from hostname
function getLocationDescription(host: string): string {
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return 'Local development server on this machine'
  }
  if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
    return 'Server on local network (private IP address)'
  }
  if (host.includes('kartoza.com')) {
    return 'Kartoza cloud infrastructure, Cape Town, South Africa'
  }
  if (host.includes('digitalocean.com') || host.includes('.do.')) {
    return 'DigitalOcean cloud infrastructure'
  }
  if (host.includes('aws.') || host.includes('amazonaws.com')) {
    return 'Amazon Web Services (AWS) cloud'
  }
  if (host.includes('azure.') || host.includes('microsoft.com')) {
    return 'Microsoft Azure cloud'
  }
  if (host.includes('gcp.') || host.includes('google')) {
    return 'Google Cloud Platform'
  }
  const parts = host.split('.')
  if (parts.length >= 2) {
    return `Remote server at ${host}`
  }
  return `Server: ${host}`
}

// Get approximate marker position based on hostname
function getMarkerPosition(host: string): { x: string; y: string } {
  if (!host || host === 'localhost' || host === '127.0.0.1' ||
      host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
    return { x: '48%', y: '35%' }
  }
  if (host.includes('kartoza.com')) {
    return { x: '53%', y: '72%' }
  }
  return { x: '50%', y: '45%' }
}

// World map component with marker
function ServerLocationMap({ host }: { host: string }) {
  const mapBg = useColorModeValue('blue.50', 'blue.900')
  const landColor = useColorModeValue('#94a3b8', '#475569')
  const dotColor = useColorModeValue('red.500', 'red.400')
  const pulseColor = useColorModeValue('red.300', 'red.600')
  const textBg = useColorModeValue('gray.100', 'gray.700')
  const textColor = useColorModeValue('gray.700', 'gray.200')

  const markerPos = getMarkerPosition(host)
  const locationDesc = getLocationDescription(host)

  return (
    <VStack spacing={3} align="stretch">
      <Box
        position="relative"
        bg={mapBg}
        borderRadius="xl"
        overflow="hidden"
        h="180px"
        w="100%"
      >
        <svg
          viewBox="0 0 900 400"
          style={{ width: '100%', height: '100%' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <path
            d={WORLD_MAP_PATH}
            fill={landColor}
            stroke={landColor}
            strokeWidth="2"
            opacity="0.6"
          />
        </svg>

        <Box
          position="absolute"
          left={markerPos.x}
          top={markerPos.y}
          transform="translate(-50%, -50%)"
        >
          <Box
            position="absolute"
            w="24px"
            h="24px"
            borderRadius="full"
            bg={pulseColor}
            animation={`${pulse} 2s ease-out infinite`}
            transform="translate(-50%, -50%)"
            left="50%"
            top="50%"
          />
          <Box
            position="absolute"
            w="24px"
            h="24px"
            borderRadius="full"
            bg={pulseColor}
            animation={`${pulse} 2s ease-out infinite 0.6s`}
            transform="translate(-50%, -50%)"
            left="50%"
            top="50%"
          />
          <Box
            w="14px"
            h="14px"
            borderRadius="full"
            bg={dotColor}
            shadow="lg"
            position="relative"
            zIndex={1}
            border="2px solid white"
          />
        </Box>

        <Box
          position="absolute"
          bottom={3}
          left={3}
          bg="blackAlpha.700"
          px={3}
          py={1.5}
          borderRadius="lg"
        >
          <HStack spacing={2}>
            <Icon as={FiMapPin} color="red.300" boxSize={4} />
            <Text fontSize="sm" color="white" fontWeight="semibold">
              {host || 'localhost'}
            </Text>
          </HStack>
        </Box>
      </Box>

      <Box
        bg={textBg}
        px={4}
        py={2}
        borderRadius="lg"
      >
        <HStack spacing={2}>
          <Icon as={FiServer} color="blue.500" boxSize={4} />
          <Text fontSize="sm" color={textColor}>
            {locationDesc}
          </Text>
        </HStack>
      </Box>
    </VStack>
  )
}

// Stat card component for PG dashboard
interface PGStatCardProps {
  label: string
  value: string | number
  helpText?: string
  icon: React.ElementType
  colorScheme?: string
}

function PGStatCard({ label, value, helpText, icon, colorScheme = 'blue' }: PGStatCardProps) {
  const bg = useColorModeValue('white', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  return (
    <Box
      bg={bg}
      p={4}
      borderRadius="xl"
      borderWidth={1}
      borderColor={borderColor}
      shadow="sm"
      transition="all 0.2s"
      _hover={{ shadow: 'md', borderColor: `${colorScheme}.300` }}
    >
      <HStack spacing={3} mb={2}>
        <Box
          p={2}
          borderRadius="lg"
          bg={`${colorScheme}.50`}
          color={`${colorScheme}.500`}
        >
          <Icon as={icon} boxSize={5} />
        </Box>
        <Text fontSize="sm" fontWeight="medium" color="gray.500">
          {label}
        </Text>
      </HStack>
      <Text fontSize="2xl" fontWeight="bold">
        {value}
      </Text>
      {helpText && (
        <Text fontSize="xs" color="gray.400" mt={1}>
          {helpText}
        </Text>
      )}
    </Box>
  )
}

// PostgreSQL Service Panel
function PGServicePanel({ serviceName }: { serviceName: string }) {
  const [stats, setStats] = useState<api.PGServerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const openDialog = useUIStore((state) => state.openDialog)

  const cardBg = useColorModeValue('white', 'gray.800')

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getPGServiceStats(serviceName)
      .then(setStats)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [serviceName])

  const pgVersionShort = useMemo(() => {
    if (!stats?.version) return 'Unknown'
    const match = stats.version.match(/PostgreSQL (\d+\.\d+)/)
    return match ? `PostgreSQL ${match[1]}` : 'PostgreSQL'
  }, [stats?.version])

  if (loading) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Spinner size="xl" color="blue.500" thickness="4px" />
          <Text color="gray.500">Loading server statistics...</Text>
        </VStack>
      </Center>
    )
  }

  if (error) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Icon as={FiAlertCircle} boxSize={12} color="red.500" />
          <Text color="red.500" fontWeight="medium">{error}</Text>
        </VStack>
      </Center>
    )
  }

  if (!stats) return null

  return (
    <VStack spacing={6} align="stretch">
      {/* Header Card */}
      <Card
        bg="linear-gradient(135deg, #336791 0%, #1a4e6d 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={SiPostgresql} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <HStack spacing={3}>
                  <Heading size="lg">{serviceName}</Heading>
                  <Badge
                    colorScheme="green"
                    variant="solid"
                    fontSize="xs"
                    px={2}
                    py={1}
                    borderRadius="full"
                  >
                    <HStack spacing={1}>
                      <Icon as={FiCheckCircle} boxSize={3} />
                      <Text>Connected</Text>
                    </HStack>
                  </Badge>
                </HStack>
                <HStack spacing={3} opacity={0.9}>
                  <Text fontSize="sm">{stats.database_name}</Text>
                  <Text fontSize="sm">|</Text>
                  <Text fontSize="sm">{pgVersionShort}</Text>
                  {stats.has_postgis && (
                    <>
                      <Text fontSize="sm">|</Text>
                      <HStack spacing={1}>
                        <Icon as={FiGlobe} boxSize={4} />
                        <Text fontSize="sm">PostGIS</Text>
                      </HStack>
                    </>
                  )}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <HStack wrap="wrap" gap={2}>
              <Button
                variant="solid"
                bg="whiteAlpha.200"
                color="white"
                _hover={{ bg: 'whiteAlpha.300' }}
                leftIcon={<FiCode />}
                onClick={() => openDialog('query', {
                  mode: 'create',
                  data: { serviceName },
                })}
              >
                SQL Query
              </Button>
              <Button
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiUpload />}
                onClick={() => openDialog('pgupload', {
                  mode: 'create',
                  data: { serviceName },
                })}
              >
                Import Data
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      {/* Server Location Map */}
      <ServerLocationMap host={stats.host} />

      {/* Connection Stats */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiUsers} color="purple.500" />
            <Text fontWeight="semibold" fontSize="lg">Connections</Text>
          </HStack>
          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
            <PGStatCard
              label="Current"
              value={stats.current_connections}
              helpText={`of ${stats.max_connections} max`}
              icon={FiUsers}
              colorScheme="purple"
            />
            <PGStatCard
              label="Active"
              value={stats.active_connections}
              helpText="executing queries"
              icon={FiActivity}
              colorScheme="green"
            />
            <PGStatCard
              label="Idle"
              value={stats.idle_connections}
              helpText="waiting for work"
              icon={FiClock}
              colorScheme="blue"
            />
            <PGStatCard
              label="Waiting"
              value={stats.waiting_connections}
              helpText="blocked on locks"
              icon={FiZap}
              colorScheme="orange"
            />
          </SimpleGrid>
          <Box mt={4}>
            <HStack justify="space-between" mb={2}>
              <Text fontSize="sm" color="gray.500">Connection Pool Usage</Text>
              <Text fontSize="sm" fontWeight="bold">{stats.connection_percent}%</Text>
            </HStack>
            <Progress
              value={stats.connection_percent}
              colorScheme={stats.connection_percent > 80 ? 'red' : stats.connection_percent > 60 ? 'orange' : 'green'}
              borderRadius="full"
              size="lg"
            />
          </Box>
        </CardBody>
      </Card>

      {/* Database Stats */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiDatabase} color="blue.500" />
            <Text fontWeight="semibold" fontSize="lg">Database</Text>
          </HStack>
          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
            <PGStatCard
              label="Size"
              value={stats.database_size}
              icon={FiHardDrive}
              colorScheme="blue"
            />
            <PGStatCard
              label="Cache Hit Ratio"
              value={stats.cache_hit_ratio}
              helpText="higher is better"
              icon={FiZap}
              colorScheme="green"
            />
            <PGStatCard
              label="Live Tuples"
              value={stats.live_tuples.toLocaleString()}
              icon={FiTable}
              colorScheme="purple"
            />
            <PGStatCard
              label="Dead Tuples"
              value={stats.dead_tuples.toLocaleString()}
              helpText="needs vacuum"
              icon={FiAlertCircle}
              colorScheme={stats.dead_tuples > 10000 ? 'red' : 'gray'}
            />
          </SimpleGrid>
        </CardBody>
      </Card>

      {/* Object Counts */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiLayers} color="teal.500" />
            <Text fontWeight="semibold" fontSize="lg">Objects</Text>
          </HStack>
          <SimpleGrid columns={{ base: 3, md: 5 }} spacing={4}>
            <PGStatCard
              label="Schemas"
              value={stats.schema_count}
              icon={FiLayers}
              colorScheme="teal"
            />
            <PGStatCard
              label="Tables"
              value={stats.table_count}
              icon={FiTable}
              colorScheme="blue"
            />
            <PGStatCard
              label="Views"
              value={stats.view_count}
              icon={FiEye}
              colorScheme="purple"
            />
            <PGStatCard
              label="Indexes"
              value={stats.index_count}
              icon={FiZap}
              colorScheme="orange"
            />
            <PGStatCard
              label="Functions"
              value={stats.function_count}
              icon={FiCode}
              colorScheme="pink"
            />
          </SimpleGrid>
        </CardBody>
      </Card>

      {/* PostGIS Section */}
      {stats.has_postgis && (
        <Card bg={cardBg}>
          <CardBody>
            <HStack mb={4}>
              <Icon as={FiGlobe} color="green.500" />
              <Text fontWeight="semibold" fontSize="lg">PostGIS</Text>
            </HStack>
            <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
              <PGStatCard
                label="Geometry Columns"
                value={stats.geometry_columns || 0}
                icon={FiGlobe}
                colorScheme="green"
              />
              <PGStatCard
                label="Raster Columns"
                value={stats.raster_columns || 0}
                icon={FiLayers}
                colorScheme="blue"
              />
            </SimpleGrid>
            {stats.postgis_version && (
              <Box mt={4} p={3} bg="green.50" borderRadius="lg" _dark={{ bg: 'green.900' }}>
                <Text fontSize="xs" color="green.700" fontFamily="mono" noOfLines={2} _dark={{ color: 'green.200' }}>
                  {stats.postgis_version}
                </Text>
              </Box>
            )}
          </CardBody>
        </Card>
      )}

      {/* Server Info */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiServer} color="gray.500" />
            <Text fontWeight="semibold" fontSize="lg">Server Info</Text>
          </HStack>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
            <Stat>
              <StatLabel>Uptime</StatLabel>
              <StatNumber fontSize="lg">{stats.uptime || 'N/A'}</StatNumber>
              <StatHelpText>Since {stats.server_start_time?.split(' ')[0]}</StatHelpText>
            </Stat>
            <Stat>
              <StatLabel>Transactions</StatLabel>
              <StatNumber fontSize="lg">
                {stats.xact_commit.toLocaleString()}
              </StatNumber>
              <StatHelpText>
                {stats.xact_rollback.toLocaleString()} rollbacks
              </StatHelpText>
            </Stat>
          </SimpleGrid>
          <Box mt={4} p={3} bg="gray.100" borderRadius="lg" _dark={{ bg: 'gray.700' }}>
            <Text fontSize="xs" color="gray.600" fontFamily="mono" noOfLines={2} _dark={{ color: 'gray.300' }}>
              {stats.version}
            </Text>
          </Box>
        </CardBody>
      </Card>

      {/* Extensions */}
      {stats.installed_extensions && stats.installed_extensions.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <HStack mb={4}>
              <Icon as={FiCode} color="indigo.500" />
              <Text fontWeight="semibold" fontSize="lg">Extensions</Text>
            </HStack>
            <Wrap spacing={2}>
              {stats.installed_extensions.map(ext => (
                <WrapItem key={ext}>
                  <Tooltip label={ext} fontSize="xs">
                    <Tag
                      size="md"
                      colorScheme={ext === 'postgis' ? 'green' : ext === 'plpgsql' ? 'blue' : 'gray'}
                      borderRadius="full"
                    >
                      {ext}
                    </Tag>
                  </Tooltip>
                </WrapItem>
              ))}
            </Wrap>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

// PostgreSQL Schema Panel
function PGSchemaPanel({ serviceName, schemaName }: { serviceName: string; schemaName: string }) {
  const [stats, setStats] = useState<api.PGSchemaStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const openDialog = useUIStore((state) => state.openDialog)

  const cardBg = useColorModeValue('white', 'gray.800')
  const tableBg = useColorModeValue('gray.50', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getPGSchemaStats(serviceName, schemaName)
      .then(setStats)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [serviceName, schemaName])

  if (loading) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Spinner size="xl" color="teal.500" thickness="4px" />
          <Text color="gray.500">Loading schema statistics...</Text>
        </VStack>
      </Center>
    )
  }

  if (error) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Icon as={FiAlertCircle} boxSize={12} color="red.500" />
          <Text color="red.500" fontWeight="medium">{error}</Text>
        </VStack>
      </Center>
    )
  }

  if (!stats) return null

  return (
    <VStack spacing={6} align="stretch">
      {/* Header Card */}
      <Card
        bg="linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiLayers} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <HStack spacing={3}>
                  <Heading size="lg">{schemaName}</Heading>
                </HStack>
                <HStack spacing={3} opacity={0.9}>
                  <Text fontSize="sm">{stats.database_name}</Text>
                  <Text fontSize="sm">|</Text>
                  <Text fontSize="sm">Owner: {stats.owner}</Text>
                  {stats.has_postgis && (
                    <>
                      <Text fontSize="sm">|</Text>
                      <HStack spacing={1}>
                        <Icon as={FiGlobe} boxSize={4} />
                        <Text fontSize="sm">PostGIS</Text>
                      </HStack>
                    </>
                  )}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <HStack wrap="wrap" gap={2}>
              <Button
                variant="solid"
                bg="whiteAlpha.200"
                color="white"
                _hover={{ bg: 'whiteAlpha.300' }}
                leftIcon={<FiCode />}
                onClick={() => openDialog('query', {
                  mode: 'create',
                  data: { serviceName, schemaName },
                })}
              >
                SQL Query
              </Button>
              <Button
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiUpload />}
                onClick={() => openDialog('pgupload', {
                  mode: 'create',
                  data: { serviceName, schemaName },
                })}
              >
                Import Data
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      {/* Size and Stats Overview */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiHardDrive} color="teal.500" />
            <Text fontWeight="semibold" fontSize="lg">Schema Size</Text>
          </HStack>
          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
            <PGStatCard
              label="Total Size"
              value={stats.total_size || '0 bytes'}
              icon={FiHardDrive}
              colorScheme="teal"
            />
            <PGStatCard
              label="Total Rows"
              value={stats.total_rows.toLocaleString()}
              icon={FiTable}
              colorScheme="blue"
            />
            <PGStatCard
              label="Dead Tuples"
              value={stats.dead_tuples.toLocaleString()}
              helpText={stats.dead_tuples > 1000 ? 'Consider VACUUM' : ''}
              icon={FiAlertCircle}
              colorScheme={stats.dead_tuples > 1000 ? 'orange' : 'gray'}
            />
            <PGStatCard
              label="Tables"
              value={stats.table_count}
              icon={FiTable}
              colorScheme="purple"
            />
          </SimpleGrid>
        </CardBody>
      </Card>

      {/* Object Counts */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiLayers} color="purple.500" />
            <Text fontWeight="semibold" fontSize="lg">Objects</Text>
          </HStack>
          <SimpleGrid columns={{ base: 3, md: 6 }} spacing={4}>
            <PGStatCard
              label="Tables"
              value={stats.table_count}
              icon={FiTable}
              colorScheme="blue"
            />
            <PGStatCard
              label="Views"
              value={stats.view_count}
              icon={FiEye}
              colorScheme="purple"
            />
            <PGStatCard
              label="Indexes"
              value={stats.index_count}
              icon={FiZap}
              colorScheme="orange"
            />
            <PGStatCard
              label="Functions"
              value={stats.function_count}
              icon={FiCode}
              colorScheme="pink"
            />
            <PGStatCard
              label="Sequences"
              value={stats.sequence_count}
              icon={FiActivity}
              colorScheme="cyan"
            />
            <PGStatCard
              label="Triggers"
              value={stats.trigger_count}
              icon={FiZap}
              colorScheme="red"
            />
          </SimpleGrid>
        </CardBody>
      </Card>

      {/* PostGIS Section */}
      {stats.has_postgis && (stats.geometry_columns > 0 || stats.raster_columns > 0) && (
        <Card bg={cardBg}>
          <CardBody>
            <HStack mb={4}>
              <Icon as={FiGlobe} color="green.500" />
              <Text fontWeight="semibold" fontSize="lg">PostGIS</Text>
            </HStack>
            <SimpleGrid columns={{ base: 2, md: 2 }} spacing={4}>
              <PGStatCard
                label="Geometry Columns"
                value={stats.geometry_columns}
                icon={FiGlobe}
                colorScheme="green"
              />
              <PGStatCard
                label="Raster Columns"
                value={stats.raster_columns}
                icon={FiImage}
                colorScheme="blue"
              />
            </SimpleGrid>
          </CardBody>
        </Card>
      )}

      {/* Tables List */}
      {stats.tables && stats.tables.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <HStack mb={4}>
              <Icon as={FiTable} color="blue.500" />
              <Text fontWeight="semibold" fontSize="lg">Tables ({stats.tables.length})</Text>
            </HStack>
            <VStack align="stretch" spacing={2}>
              {stats.tables.map(table => (
                <Box
                  key={table.name}
                  p={3}
                  bg={tableBg}
                  borderRadius="lg"
                  borderWidth={1}
                  borderColor={borderColor}
                >
                  <Flex align="center" wrap="wrap" gap={2}>
                    <HStack flex="1" minW="200px">
                      <Icon
                        as={table.has_geometry ? FiGlobe : FiTable}
                        color={table.has_geometry ? 'green.500' : 'blue.500'}
                        boxSize={4}
                      />
                      <Text fontWeight="medium">{table.name}</Text>
                      {table.has_primary_key && (
                        <Tooltip label="Has Primary Key">
                          <Badge colorScheme="blue" size="sm" variant="subtle">PK</Badge>
                        </Tooltip>
                      )}
                      {table.has_geometry && (
                        <Tooltip label={`${table.geometry_type} (SRID: ${table.srid})`}>
                          <Badge colorScheme="green" size="sm" variant="subtle">
                            {table.geometry_type}
                          </Badge>
                        </Tooltip>
                      )}
                    </HStack>
                    <HStack spacing={4} fontSize="sm" color="gray.500">
                      <Tooltip label="Row count">
                        <HStack spacing={1}>
                          <Icon as={FiTable} boxSize={3} />
                          <Text>{table.row_count.toLocaleString()} rows</Text>
                        </HStack>
                      </Tooltip>
                      <Tooltip label="Table size">
                        <HStack spacing={1}>
                          <Icon as={FiHardDrive} boxSize={3} />
                          <Text>{table.size}</Text>
                        </HStack>
                      </Tooltip>
                      <Tooltip label="Index count">
                        <HStack spacing={1}>
                          <Icon as={FiZap} boxSize={3} />
                          <Text>{table.index_count} idx</Text>
                        </HStack>
                      </Tooltip>
                      {table.dead_tuples > 0 && (
                        <Tooltip label="Dead tuples - consider VACUUM">
                          <HStack spacing={1} color={table.dead_tuples > 100 ? 'orange.500' : 'gray.500'}>
                            <Icon as={FiAlertCircle} boxSize={3} />
                            <Text>{table.dead_tuples} dead</Text>
                          </HStack>
                        </Tooltip>
                      )}
                    </HStack>
                    <HStack spacing={2}>
                      <Tooltip label="View data">
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="blue"
                          onClick={() => openDialog('dataviewer', {
                            mode: 'view',
                            data: {
                              serviceName,
                              schemaName,
                              tableName: table.name,
                            },
                          })}
                        >
                          <Icon as={FiEye} />
                        </Button>
                      </Tooltip>
                      <Tooltip label="Query">
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="teal"
                          onClick={() => openDialog('query', {
                            mode: 'view',
                            data: {
                              serviceName,
                              schemaName,
                              tableName: table.name,
                              initialSQL: `SELECT * FROM "${schemaName}"."${table.name}" LIMIT 100`,
                            },
                          })}
                        >
                          <Icon as={FiCode} />
                        </Button>
                      </Tooltip>
                    </HStack>
                  </Flex>
                </Box>
              ))}
            </VStack>
          </CardBody>
        </Card>
      )}

      {/* Views List */}
      {stats.views && stats.views.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <HStack mb={4}>
              <Icon as={FiEye} color="purple.500" />
              <Text fontWeight="semibold" fontSize="lg">Views ({stats.views.length})</Text>
            </HStack>
            <VStack align="stretch" spacing={2}>
              {stats.views.map(view => (
                <Box
                  key={view.name}
                  p={3}
                  bg={tableBg}
                  borderRadius="lg"
                  borderWidth={1}
                  borderColor={borderColor}
                >
                  <Flex align="center" wrap="wrap" gap={2}>
                    <HStack flex="1">
                      <Icon as={FiEye} color="purple.500" boxSize={4} />
                      <Text fontWeight="medium">{view.name}</Text>
                      {view.is_materialized && (
                        <Badge colorScheme="orange" size="sm" variant="subtle">
                          Materialized
                        </Badge>
                      )}
                    </HStack>
                    <HStack spacing={2}>
                      <Tooltip label="View data">
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="purple"
                          onClick={() => openDialog('dataviewer', {
                            mode: 'view',
                            data: {
                              serviceName,
                              schemaName,
                              tableName: view.name,
                              isView: true,
                            },
                          })}
                        >
                          <Icon as={FiEye} />
                        </Button>
                      </Tooltip>
                      <Tooltip label="Query">
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="teal"
                          onClick={() => openDialog('query', {
                            mode: 'view',
                            data: {
                              serviceName,
                              schemaName,
                              tableName: view.name,
                              initialSQL: `SELECT * FROM "${schemaName}"."${view.name}" LIMIT 100`,
                            },
                          })}
                        >
                          <Icon as={FiCode} />
                        </Button>
                      </Tooltip>
                    </HStack>
                  </Flex>
                </Box>
              ))}
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

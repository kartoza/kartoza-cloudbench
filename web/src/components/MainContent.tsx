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
} from '@chakra-ui/react'
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
} from 'react-icons/fi'
import { useEffect, useRef } from 'react'
import { useTreeStore } from '../stores/treeStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api/client'
import { useUIStore } from '../stores/uiStore'
import MapPreview from './MapPreview'
import { SettingsDialog } from './dialogs/SettingsDialog'
import Dashboard from './Dashboard'

export default function MainContent() {
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const activePreview = useUIStore((state) => state.activePreview)
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
        <MapPreview
          key={`${activePreview.workspace}:${activePreview.layerName}:${activePreview.url}`}
          previewUrl={activePreview.url}
          layerName={activePreview.layerName}
          workspace={activePreview.workspace}
          storeName={activePreview.storeName}
          storeType={activePreview.storeType}
          layerType={activePreview.layerType}
          onClose={() => setPreview(null)}
        />
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
    case 'layergroup':
      return (
        <LayerGroupPanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          groupName={selectedNode.name}
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
                        <Icon as={FiEdit3} color="kartoza.500" />
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

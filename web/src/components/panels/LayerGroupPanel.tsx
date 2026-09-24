import {
  VStack,
  Card,
  CardBody,
  Flex,
  HStack,
  Box,
  Icon,
  Heading,
  Text,
  Spacer,
  Button,
  Badge,
  SimpleGrid,
  Divider,
  useColorModeValue,
} from '@chakra-ui/react'
import { FiGrid, FiMap, FiDatabase, FiEdit3 } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'

interface LayerGroupPanelProps {
  connectionId: string
  workspace: string
  groupName: string
}

export default function LayerGroupPanel({
  connectionId,
  workspace,
  groupName,
}: LayerGroupPanelProps) {
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
        bg="surface.header"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiGrid} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg" color="white">{groupName}</Heading>
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

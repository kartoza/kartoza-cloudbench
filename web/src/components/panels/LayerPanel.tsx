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
import { FiLayers, FiMap, FiDatabase, FiEdit3 } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'

interface LayerPanelProps {
  connectionId: string
  workspace: string
  layerName: string
}

export default function LayerPanel({
  connectionId,
  workspace,
  layerName,
}: LayerPanelProps) {
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
        bg="surface.header"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiLayers} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg" color="white">{layerName}</Heading>
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

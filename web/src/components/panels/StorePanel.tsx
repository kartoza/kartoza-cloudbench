import { useState } from 'react'
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
  Spinner,
  useToast,
} from '@chakra-ui/react'
import {
  FiImage,
  FiMap,
  FiEdit3,
  FiUpload,
  FiDatabase
} from 'react-icons/fi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import { DatasetRow } from '../connection-tree/DatasetRow'

interface StorePanelProps {
  connectionId: string
  workspace: string
  storeName: string
  storeType: 'datastore' | 'coveragestore'
}

export default function StorePanel({
  connectionId,
  workspace,
  storeName,
  storeType,
}: StorePanelProps) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const setPreview = useUIStore((state) => state.setPreview)
  const openDialog = useUIStore((state) => state.openDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  const isDataStore = storeType === 'datastore'

  const [selectedForPublish, setSelectedForPublish] = useState<Set<string>>(new Set())
  const [isPublishing, setIsPublishing] = useState(false)
  const bgAvailable = useColorModeValue('yellow.50', 'yellow.900')

  const { data: available = [], isFetching: loadingAvailable } = useQuery({
    queryKey: ['available-featuretypes', connectionId, workspace, storeName],
    queryFn: () => api.getAvailableFeatureTypes(connectionId, workspace, storeName),
    enabled: isDataStore,
  })

  const invalidateAfterPublish = () => {
    queryClient.invalidateQueries({ queryKey: ['featuretypes', connectionId, workspace, storeName] })
    queryClient.invalidateQueries({ queryKey: ['available-featuretypes', connectionId, workspace, storeName] })
    queryClient.invalidateQueries({ queryKey: ['layers', connectionId, workspace] })
  }

  const toggleSelection = (name: string) =>
    setSelectedForPublish((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const handlePublishSelected = async () => {
    if (selectedForPublish.size === 0) return
    setIsPublishing(true)
    try {
      const result = await api.publishFeatureTypes(connectionId, workspace, storeName, Array.from(selectedForPublish))
      if (result.published.length > 0) {
        toast({ title: 'Layers Published', description: `Successfully published ${result.published.length} layer(s)`, status: 'success', duration: 3000 })
        setSelectedForPublish(new Set())
        invalidateAfterPublish()
      }
      if (result.errors.length > 0) {
        toast({ title: 'Some layers failed', description: result.errors.map((e) => e.name).join(', '), status: 'warning', duration: 5000 })
      }
    } catch (err) {
      toast({ title: 'Failed to publish', description: (err as Error).message, status: 'error', duration: 5000 })
    } finally {
      setIsPublishing(false)
    }
  }

  const handlePublishSingle = async (name: string) => {
    try {
      await api.publishFeatureType(connectionId, workspace, storeName, name)
      toast({ title: 'Layer Published', description: `Successfully published ${name}`, status: 'success', duration: 3000 })
      invalidateAfterPublish()
    } catch (err) {
      toast({ title: 'Failed to publish layer', description: (err as Error).message, status: 'error', duration: 5000 })
    }
  }

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
        bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={isDataStore ? FiDatabase : FiImage} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg" color="white">{storeName}</Heading>
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

      {isDataStore && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={3}>
              <HStack justify="space-between">
                <Heading size="sm" color="gray.600">Available to Publish</Heading>
                {selectedForPublish.size > 0 && (
                  <Badge colorScheme="kartoza">{selectedForPublish.size} selected</Badge>
                )}
              </HStack>
              <Divider />

              {loadingAvailable ? (
                <HStack justify="center" py={4}>
                  <Spinner size="sm" />
                  <Text fontSize="sm" color="gray.500">Loading available layers…</Text>
                </HStack>
              ) : available.length === 0 ? (
                <Text fontSize="sm" color="gray.500" textAlign="center" py={4}>
                  No unpublished layers found
                </Text>
              ) : (
                <Box>
                  <Flex align="center" justify="space-between" px={2} py={1}>
                    <Text fontSize="xs" color="gray.500">
                      {available.length} layer(s) available
                    </Text>
                    <Flex gap={1}>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setSelectedForPublish(new Set(available))}
                        isDisabled={selectedForPublish.size === available.length}
                      >
                        Select All
                      </Button>
                      {selectedForPublish.size > 0 && (
                        <Button
                          size="xs"
                          colorScheme="kartoza"
                          leftIcon={<FiUpload size={12} />}
                          onClick={handlePublishSelected}
                          isLoading={isPublishing}
                        >
                          Publish ({selectedForPublish.size})
                        </Button>
                      )}
                    </Flex>
                  </Flex>
                  {available.map((name) => (
                    <DatasetRow
                      key={name}
                      name={name}
                      isPublished={false}
                      bg={bgAvailable}
                      isSelected={selectedForPublish.has(name)}
                      onToggleSelect={() => toggleSelection(name)}
                      onPublish={() => handlePublishSingle(name)}
                    />
                  ))}
                </Box>
              )}
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

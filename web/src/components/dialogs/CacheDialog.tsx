import { useState, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Select,
  VStack,
  HStack,
  Box,
  Text,
  Icon,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Progress,
  Badge,
  Spinner,
  Alert,
  AlertIcon,
  useToast,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  IconButton,
  Tooltip,
} from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FiDatabase, FiPlay, FiTrash2, FiStopCircle, FiRefreshCw } from 'react-icons/fi'
import { useUIStore } from '../../stores/uiStore'
import { useTreeStore } from '../../stores/treeStore'
import * as api from '../../api'
import type { GWCSeedRequest, GWCSeedTask } from '../../types'

export default function CacheDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const [activeTab, setActiveTab] = useState(0)
  const [selectedGridSet, setSelectedGridSet] = useState('')
  const [selectedFormat, setSelectedFormat] = useState('image/png')
  const [zoomStart, setZoomStart] = useState(0)
  const [zoomStop, setZoomStop] = useState(10)
  const [threadCount, setThreadCount] = useState(2)
  const [seedType, setSeedType] = useState<'seed' | 'reseed'>('seed')
  const [isLoading, setIsLoading] = useState(false)

  const toast = useToast()
  const queryClient = useQueryClient()

  const isOpen = activeDialog === 'info' && dialogData?.title === 'Tile Cache'
  const layerName = dialogData?.data?.layerName as string || ''
  const connectionId = dialogData?.data?.connectionId as string || selectedNode?.connectionId || ''
  const workspace = dialogData?.data?.workspace as string || selectedNode?.workspace || ''
  const fullLayerName = workspace ? `${workspace}:${layerName}` : layerName

  // Fetch layer cache info
  const { data: layerCache, isLoading: isLoadingCache } = useQuery({
    queryKey: ['gwc-layer', connectionId, fullLayerName],
    queryFn: () => api.getGWCLayer(connectionId, fullLayerName),
    enabled: isOpen && !!connectionId && !!fullLayerName,
  })

  // Fetch seed status (polling while seeding)
  const { data: seedStatus, refetch: refetchSeedStatus } = useQuery({
    queryKey: ['gwc-seed-status', connectionId, fullLayerName],
    queryFn: () => api.getGWCSeedStatus(connectionId, fullLayerName),
    enabled: isOpen && !!connectionId && !!fullLayerName,
    refetchInterval: activeTab === 1 ? 2000 : false, // Poll every 2 seconds on progress tab
  })

  // Set default grid set when data loads
  useEffect(() => {
    if (layerCache?.gridSubsets?.[0] && !selectedGridSet) {
      setSelectedGridSet(layerCache.gridSubsets[0])
    }
    if (layerCache?.mimeFormats?.[0] && selectedFormat === 'image/png') {
      const hasPng = layerCache.mimeFormats.includes('image/png')
      if (!hasPng && layerCache.mimeFormats[0]) {
        setSelectedFormat(layerCache.mimeFormats[0])
      }
    }
  }, [layerCache, selectedGridSet, selectedFormat])

  const handleSeed = async () => {
    if (!selectedGridSet || !selectedFormat) {
      toast({
        title: 'Select grid set and format',
        status: 'error',
        duration: 3000,
      })
      return
    }

    setIsLoading(true)

    try {
      const request: GWCSeedRequest = {
        gridSetId: selectedGridSet,
        format: selectedFormat,
        zoomStart,
        zoomStop,
        type: seedType,
        threadCount,
      }

      await api.seedLayer(connectionId, fullLayerName, request)

      toast({
        title: `${seedType === 'seed' ? 'Seeding' : 'Reseeding'} started`,
        description: `Layer: ${layerName}`,
        status: 'success',
        duration: 3000,
      })

      // Switch to progress tab
      setActiveTab(1)
      refetchSeedStatus()
    } catch (err) {
      toast({
        title: 'Failed to start seeding',
        description: err instanceof Error ? err.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleTruncate = async () => {
    setIsLoading(true)

    try {
      await api.truncateLayer(connectionId, fullLayerName, {
        gridSetId: selectedGridSet || undefined,
        format: selectedFormat || undefined,
        zoomStart,
        zoomStop,
      })

      toast({
        title: 'Cache truncated',
        description: `Layer: ${layerName}`,
        status: 'success',
        duration: 3000,
      })

      queryClient.invalidateQueries({ queryKey: ['gwc-layer', connectionId, fullLayerName] })
    } catch (err) {
      toast({
        title: 'Failed to truncate cache',
        description: err instanceof Error ? err.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleTerminateTask = async () => {
    try {
      await api.terminateLayerSeed(connectionId, fullLayerName)
      toast({
        title: 'Seed tasks terminated',
        status: 'success',
        duration: 3000,
      })
      refetchSeedStatus()
    } catch (err) {
      toast({
        title: 'Failed to terminate tasks',
        description: err instanceof Error ? err.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    }
  }

  const formatTime = (seconds: number): string => {
    if (seconds < 0) return 'Unknown'
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'Running':
        return 'blue'
      case 'Pending':
        return 'yellow'
      case 'Done':
        return 'green'
      case 'Aborted':
        return 'red'
      default:
        return 'gray'
    }
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="85vh">
        {/* Gradient Header */}
        <Box
          bg="surface.header"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiDatabase} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Tile Cache Management
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {fullLayerName}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={4} overflowY="auto">
          {isLoadingCache ? (
            <HStack justify="center" py={6}>
              <Spinner size="sm" color="kartoza.500" />
              <Text fontSize="sm" color="gray.500">Loading cache info...</Text>
            </HStack>
          ) : !layerCache ? (
            <Alert status="warning" borderRadius="md">
              <AlertIcon />
              <Text fontSize="sm">No cache configuration found for this layer</Text>
            </Alert>
          ) : (
            <Tabs index={activeTab} onChange={setActiveTab} colorScheme="kartoza">
              <TabList>
                <Tab>Seed / Truncate</Tab>
                <Tab>
                  Progress
                  {seedStatus && seedStatus.length > 0 && (
                    <Badge ml={2} colorScheme="blue" borderRadius="sm">
                      {seedStatus.length}
                    </Badge>
                  )}
                </Tab>
                <Tab>Info</Tab>
              </TabList>

              <TabPanels>
                {/* Seed / Truncate Tab */}
                <TabPanel px={0}>
                  <VStack spacing={4} align="stretch">
                    <FormControl>
                      <FormLabel fontWeight="500" color="gray.700">Grid Set</FormLabel>
                      <Select
                        value={selectedGridSet}
                        onChange={(e) => setSelectedGridSet(e.target.value)}
                        borderRadius="lg"
                      >
                        {layerCache.gridSubsets?.map((gs) => (
                          <option key={gs} value={gs}>{gs}</option>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl>
                      <FormLabel fontWeight="500" color="gray.700">Format</FormLabel>
                      <Select
                        value={selectedFormat}
                        onChange={(e) => setSelectedFormat(e.target.value)}
                        borderRadius="lg"
                      >
                        {layerCache.mimeFormats?.map((fmt) => (
                          <option key={fmt} value={fmt}>{fmt}</option>
                        ))}
                      </Select>
                    </FormControl>

                    <HStack spacing={4}>
                      <FormControl>
                        <FormLabel fontWeight="500" color="gray.700">Zoom Start</FormLabel>
                        <NumberInput
                          value={zoomStart}
                          onChange={(_, val) => setZoomStart(val || 0)}
                          min={0}
                          max={zoomStop}
                        >
                          <NumberInputField borderRadius="lg" />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </FormControl>

                      <FormControl>
                        <FormLabel fontWeight="500" color="gray.700">Zoom Stop</FormLabel>
                        <NumberInput
                          value={zoomStop}
                          onChange={(_, val) => setZoomStop(val || 10)}
                          min={zoomStart}
                          max={25}
                        >
                          <NumberInputField borderRadius="lg" />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </FormControl>
                    </HStack>

                    <HStack spacing={4}>
                      <FormControl>
                        <FormLabel fontWeight="500" color="gray.700">Operation</FormLabel>
                        <Select
                          value={seedType}
                          onChange={(e) => setSeedType(e.target.value as 'seed' | 'reseed')}
                          borderRadius="lg"
                        >
                          <option value="seed">Seed (generate new tiles)</option>
                          <option value="reseed">Reseed (regenerate all tiles)</option>
                        </Select>
                      </FormControl>

                      <FormControl>
                        <FormLabel fontWeight="500" color="gray.700">Threads</FormLabel>
                        <NumberInput
                          value={threadCount}
                          onChange={(_, val) => setThreadCount(val || 1)}
                          min={1}
                          max={16}
                        >
                          <NumberInputField borderRadius="lg" />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </FormControl>
                    </HStack>

                    <HStack spacing={3} pt={4}>
                      <Button
                        leftIcon={<Icon as={FiPlay} />}
                        colorScheme="kartoza"
                        onClick={handleSeed}
                        isLoading={isLoading}
                        flex={1}
                        borderRadius="lg"
                      >
                        {seedType === 'seed' ? 'Seed Tiles' : 'Reseed Tiles'}
                      </Button>
                      <Button
                        leftIcon={<Icon as={FiTrash2} />}
                        colorScheme="red"
                        variant="outline"
                        onClick={handleTruncate}
                        isLoading={isLoading}
                        flex={1}
                        borderRadius="lg"
                      >
                        Truncate Cache
                      </Button>
                    </HStack>
                  </VStack>
                </TabPanel>

                {/* Progress Tab */}
                <TabPanel px={0}>
                  <VStack spacing={4} align="stretch">
                    <HStack justify="space-between">
                      <Text fontWeight="500" color="gray.700">Running Tasks</Text>
                      <HStack>
                        <Tooltip label="Refresh status">
                          <IconButton
                            aria-label="Refresh"
                            icon={<Icon as={FiRefreshCw} />}
                            size="sm"
                            variant="ghost"
                            onClick={() => refetchSeedStatus()}
                          />
                        </Tooltip>
                        {seedStatus && seedStatus.length > 0 && (
                          <Button
                            leftIcon={<Icon as={FiStopCircle} />}
                            size="sm"
                            colorScheme="red"
                            variant="outline"
                            onClick={handleTerminateTask}
                          >
                            Stop All
                          </Button>
                        )}
                      </HStack>
                    </HStack>

                    {!seedStatus || seedStatus.length === 0 ? (
                      <Alert status="info" borderRadius="md">
                        <AlertIcon />
                        <Text fontSize="sm">No active seeding tasks</Text>
                      </Alert>
                    ) : (
                      <Box border="1px solid" borderColor="gray.200" borderRadius="lg" overflow="hidden">
                        <Table size="sm">
                          <Thead bg="gray.50">
                            <Tr>
                              <Th>Status</Th>
                              <Th>Progress</Th>
                              <Th>Tiles</Th>
                              <Th>ETA</Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {seedStatus.map((task: GWCSeedTask) => (
                              <Tr key={task.id}>
                                <Td>
                                  <Badge colorScheme={getStatusColor(task.status)}>
                                    {task.status}
                                  </Badge>
                                </Td>
                                <Td>
                                  <VStack spacing={1} align="stretch">
                                    <Progress
                                      value={task.progress}
                                      size="sm"
                                      colorScheme="kartoza"
                                      borderRadius="sm"
                                    />
                                    <Text fontSize="xs" color="gray.500">
                                      {task.progress.toFixed(1)}%
                                    </Text>
                                  </VStack>
                                </Td>
                                <Td>
                                  <Text fontSize="sm">
                                    {task.tilesDone.toLocaleString()} / {task.tilesTotal.toLocaleString()}
                                  </Text>
                                </Td>
                                <Td>
                                  <Text fontSize="sm">{formatTime(task.timeRemaining)}</Text>
                                </Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </Table>
                      </Box>
                    )}
                  </VStack>
                </TabPanel>

                {/* Info Tab */}
                <TabPanel px={0}>
                  <VStack spacing={3} align="stretch">
                    <Box p={4} bg="gray.50" borderRadius="lg">
                      <Text fontWeight="500" mb={2}>Cache Status</Text>
                      <HStack>
                        <Badge colorScheme={layerCache.enabled ? 'green' : 'red'}>
                          {layerCache.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </HStack>
                    </Box>

                    <Box p={4} bg="gray.50" borderRadius="lg">
                      <Text fontWeight="500" mb={2}>Available Grid Sets</Text>
                      <HStack flexWrap="wrap" gap={2}>
                        {layerCache.gridSubsets?.map((gs) => (
                          <Badge key={gs} colorScheme="blue" variant="subtle">
                            {gs}
                          </Badge>
                        ))}
                      </HStack>
                    </Box>

                    <Box p={4} bg="gray.50" borderRadius="lg">
                      <Text fontWeight="500" mb={2}>Supported Formats</Text>
                      <HStack flexWrap="wrap" gap={2}>
                        {layerCache.mimeFormats?.map((fmt) => (
                          <Badge key={fmt} colorScheme="purple" variant="subtle">
                            {fmt}
                          </Badge>
                        ))}
                      </HStack>
                    </Box>
                  </VStack>
                </TabPanel>
              </TabPanels>
            </Tabs>
          )}
        </ModalBody>

        <ModalFooter
          gap={3}
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          <Button variant="ghost" onClick={closeDialog} borderRadius="lg">
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

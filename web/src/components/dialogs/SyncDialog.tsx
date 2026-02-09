import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  Box,
  Flex,
  VStack,
  HStack,
  Text,
  Icon,
  IconButton,
  Badge,
  Progress,
  Checkbox,
  Select,
  Input,
  FormControl,
  FormLabel,
  Tooltip,
  useToast,
  Divider,
  SimpleGrid,
  Spinner,
  Collapse,
  useDisclosure,
} from '@chakra-ui/react'
import { keyframes, css } from '@emotion/react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import {
  FiServer,
  FiDatabase,
  FiArrowRight,
  FiArrowLeft,
  FiPlay,
  FiSquare,
  FiTrash2,
  FiSave,
  FiRefreshCw,
  FiCheckCircle,
  FiXCircle,
  FiPlusCircle,
  FiChevronDown,
  FiChevronUp,
  FiLayers,
  FiFolder,
  FiGrid,
  FiImage,
  FiEdit3,
  FiPackage,
  FiActivity,
  FiDownload,
  FiX,
} from 'react-icons/fi'
import * as api from '../../api/client'
import type { Connection, SyncConfiguration, SyncTask, SyncOptions, StartSyncRequest } from '../../types'
import { useUIStore } from '../../stores/uiStore'
import { useConnectionStore } from '../../stores/connectionStore'

// Keyframe animation definitions using Chakra-compatible format
const pulseOutKeyframes = keyframes`
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.6; }
  100% { transform: scale(1.6); opacity: 0; }
`

const pulseInKeyframes = keyframes`
  0% { transform: scale(1.6); opacity: 0; }
  50% { transform: scale(1.3); opacity: 0.6; }
  100% { transform: scale(1); opacity: 1; }
`

const flowRightKeyframes = keyframes`
  0% { transform: translateX(-10px); opacity: 0; }
  50% { opacity: 1; }
  100% { transform: translateX(10px); opacity: 0; }
`

const rotateSyncKeyframes = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

const glowPulseKeyframes = keyframes`
  0%, 100% { box-shadow: 0 0 5px rgba(56, 178, 172, 0.3); }
  50% { box-shadow: 0 0 20px rgba(56, 178, 172, 0.6); }
`

interface SourceServerProps {
  connection: Connection | null
  isSelected: boolean
  onSelect: () => void
  isHovered: boolean
  onHover: (hover: boolean) => void
}

function SourceServer({ connection, isSelected, onSelect, isHovered, onHover }: SourceServerProps) {
  return (
    <Box
      position="relative"
      p={4}
      bg={isSelected ? 'green.50' : 'gray.50'}
      borderRadius="lg"
      border="2px solid"
      borderColor={isSelected ? 'green.400' : isHovered ? 'green.300' : 'gray.200'}
      cursor="pointer"
      transition="all 0.3s ease"
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      _hover={{ borderColor: 'green.300', bg: 'green.50' }}
    >
      {/* Radiating pulse effect on hover */}
      {(isHovered || isSelected) && (
        <>
          <Box
            position="absolute"
            top="50%"
            left="50%"
            transform="translate(-50%, -50%)"
            w="60px"
            h="60px"
            borderRadius="full"
            border="2px solid"
            borderColor="green.300"
            css={css`animation: ${pulseOutKeyframes} 1.5s ease-out infinite;`}
          />
          <Box
            position="absolute"
            top="50%"
            left="50%"
            transform="translate(-50%, -50%)"
            w="60px"
            h="60px"
            borderRadius="full"
            border="2px solid"
            borderColor="green.300"
            css={css`animation: ${pulseOutKeyframes} 1.5s ease-out infinite 0.5s;`}
          />
        </>
      )}

      <VStack spacing={2} position="relative" zIndex={1}>
        <Box position="relative">
          <Icon
            as={FiServer}
            w={10}
            h={10}
            color={isSelected ? 'green.500' : 'gray.400'}
          />
          {isSelected && (
            <Icon
              as={FiCheckCircle}
              position="absolute"
              bottom={-1}
              right={-1}
              w={4}
              h={4}
              color="green.500"
              bg="white"
              borderRadius="full"
            />
          )}
        </Box>
        <Text fontWeight="bold" fontSize="sm" textAlign="center" noOfLines={1}>
          {connection?.name || 'No server'}
        </Text>
        <Badge colorScheme="green" fontSize="xs">
          SOURCE
        </Badge>
      </VStack>
    </Box>
  )
}

interface DestinationServerProps {
  connection: Connection
  isRunning: boolean
  task?: SyncTask
  onRemove: () => void
  onStop: () => void
}

function DestinationServer({ connection, isRunning, task, onRemove, onStop }: DestinationServerProps) {
  const progress = task?.progress || 0

  return (
    <Box
      position="relative"
      p={4}
      bg={isRunning ? 'blue.50' : task?.status === 'completed' ? 'green.50' : task?.status === 'failed' ? 'red.50' : 'gray.50'}
      borderRadius="lg"
      border="2px solid"
      borderColor={isRunning ? 'blue.400' : task?.status === 'completed' ? 'green.400' : task?.status === 'failed' ? 'red.400' : 'gray.200'}
      transition="all 0.3s ease"
      css={isRunning ? css`animation: ${glowPulseKeyframes} 2s ease-in-out infinite;` : undefined}
    >
      {/* Inward pulse effect when receiving */}
      {isRunning && (
        <Box
          position="absolute"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
          w="60px"
          h="60px"
          borderRadius="full"
          border="2px solid"
          borderColor="blue.300"
          css={css`animation: ${pulseInKeyframes} 1.5s ease-in infinite;`}
        />
      )}

      <VStack spacing={2} position="relative" zIndex={1}>
        <Box position="relative">
          <Icon
            as={FiDatabase}
            w={10}
            h={10}
            color={isRunning ? 'blue.500' : task?.status === 'completed' ? 'green.500' : task?.status === 'failed' ? 'red.500' : 'gray.400'}
            css={isRunning ? css`animation: ${rotateSyncKeyframes} 2s linear infinite;` : undefined}
          />
          {task?.status === 'completed' && (
            <Icon
              as={FiCheckCircle}
              position="absolute"
              bottom={-1}
              right={-1}
              w={4}
              h={4}
              color="green.500"
              bg="white"
              borderRadius="full"
            />
          )}
          {task?.status === 'failed' && (
            <Icon
              as={FiXCircle}
              position="absolute"
              bottom={-1}
              right={-1}
              w={4}
              h={4}
              color="red.500"
              bg="white"
              borderRadius="full"
            />
          )}
        </Box>
        <Text fontWeight="bold" fontSize="sm" textAlign="center" noOfLines={1}>
          {connection.name}
        </Text>
        <Badge colorScheme="blue" fontSize="xs">
          DESTINATION
        </Badge>

        {/* Progress bar */}
        {(isRunning || task) && (
          <Box w="100%" mt={2}>
            <Progress
              value={progress}
              size="sm"
              colorScheme={task?.status === 'failed' ? 'red' : task?.status === 'completed' ? 'green' : 'blue'}
              borderRadius="full"
              hasStripe={isRunning}
              isAnimated={isRunning}
            />
            <Text fontSize="xs" color="gray.500" textAlign="center" mt={1}>
              {task?.currentItem || `${progress}%`}
            </Text>
          </Box>
        )}

        {/* Control buttons */}
        <HStack spacing={1} mt={2}>
          {isRunning ? (
            <Tooltip label="Stop sync">
              <IconButton
                aria-label="Stop sync"
                icon={<FiSquare />}
                size="xs"
                colorScheme="red"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onStop(); }}
              />
            </Tooltip>
          ) : (
            <Tooltip label="Remove">
              <IconButton
                aria-label="Remove destination"
                icon={<FiTrash2 />}
                size="xs"
                colorScheme="red"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
              />
            </Tooltip>
          )}
        </HStack>
      </VStack>
    </Box>
  )
}

interface ConnectorLineProps {
  isActive: boolean
}

function ConnectorLine({ isActive }: ConnectorLineProps) {
  return (
    <Box position="relative" minW="80px" display="flex" alignItems="center" justifyContent="center">
      {/* Base line */}
      <Box
        h="2px"
        flex={1}
        bg={isActive ? 'blue.400' : 'gray.300'}
        transition="background 0.3s ease"
      />

      {/* Animated arrows */}
      {isActive && (
        <>
          <Icon
            as={FiArrowRight}
            position="absolute"
            color="blue.500"
            css={css`animation: ${flowRightKeyframes} 1s ease-in-out infinite;`}
          />
          <Icon
            as={FiArrowRight}
            position="absolute"
            color="blue.500"
            css={css`animation: ${flowRightKeyframes} 1s ease-in-out infinite 0.33s;`}
          />
          <Icon
            as={FiArrowRight}
            position="absolute"
            color="blue.500"
            css={css`animation: ${flowRightKeyframes} 1s ease-in-out infinite 0.66s;`}
          />
        </>
      )}

      {/* Static arrow when not active */}
      {!isActive && (
        <Icon as={FiArrowRight} position="absolute" color="gray.400" />
      )}
    </Box>
  )
}

interface SyncOptionsProps {
  options: SyncOptions
  onChange: (options: SyncOptions) => void
}

function SyncOptionsPanel({ options, onChange }: SyncOptionsProps) {
  const { isOpen, onToggle } = useDisclosure({ defaultIsOpen: true })

  const handleToggle = (key: keyof SyncOptions) => {
    onChange({ ...options, [key]: !options[key] })
  }

  return (
    <Box bg="gray.50" borderRadius="md" p={3}>
      <Flex justify="space-between" align="center" cursor="pointer" onClick={onToggle}>
        <HStack>
          <Icon as={FiPackage} color="kartoza.500" />
          <Text fontWeight="bold" fontSize="sm">Sync Options</Text>
        </HStack>
        <Icon as={isOpen ? FiChevronUp : FiChevronDown} />
      </Flex>

      <Collapse in={isOpen}>
        <SimpleGrid columns={3} gap={3} mt={3}>
          <Checkbox
            isChecked={options.workspaces}
            onChange={() => handleToggle('workspaces')}
            colorScheme="kartoza"
          >
            <HStack spacing={1}>
              <Icon as={FiFolder} color="yellow.500" boxSize={3} />
              <Text fontSize="sm">Workspaces</Text>
            </HStack>
          </Checkbox>

          <Checkbox
            isChecked={options.datastores}
            onChange={() => handleToggle('datastores')}
            colorScheme="kartoza"
          >
            <HStack spacing={1}>
              <Icon as={FiDatabase} color="blue.500" boxSize={3} />
              <Text fontSize="sm">Data Stores</Text>
            </HStack>
          </Checkbox>

          <Checkbox
            isChecked={options.coveragestores}
            onChange={() => handleToggle('coveragestores')}
            colorScheme="kartoza"
          >
            <HStack spacing={1}>
              <Icon as={FiImage} color="green.500" boxSize={3} />
              <Text fontSize="sm">Coverage Stores</Text>
            </HStack>
          </Checkbox>

          <Checkbox
            isChecked={options.layers}
            onChange={() => handleToggle('layers')}
            colorScheme="kartoza"
          >
            <HStack spacing={1}>
              <Icon as={FiLayers} color="purple.500" boxSize={3} />
              <Text fontSize="sm">Layers</Text>
            </HStack>
          </Checkbox>

          <Checkbox
            isChecked={options.styles}
            onChange={() => handleToggle('styles')}
            colorScheme="kartoza"
          >
            <HStack spacing={1}>
              <Icon as={FiEdit3} color="pink.500" boxSize={3} />
              <Text fontSize="sm">Styles</Text>
            </HStack>
          </Checkbox>

          <Checkbox
            isChecked={options.layergroups}
            onChange={() => handleToggle('layergroups')}
            colorScheme="kartoza"
          >
            <HStack spacing={1}>
              <Icon as={FiGrid} color="orange.500" boxSize={3} />
              <Text fontSize="sm">Layer Groups</Text>
            </HStack>
          </Checkbox>
        </SimpleGrid>
      </Collapse>
    </Box>
  )
}

interface SyncLogPanelProps {
  tasks: SyncTask[]
}

function SyncLogPanel({ tasks }: SyncLogPanelProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const { isOpen, onToggle } = useDisclosure({ defaultIsOpen: false })

  const allLogs = tasks.flatMap(t => t.log || [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [allLogs.length])

  const handleDownloadLogs = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Download logs for each task
    tasks.forEach(task => {
      if (task.id) {
        api.downloadSyncLogs(task.id)
      }
    })
  }

  if (tasks.length === 0) return null

  return (
    <Box bg="gray.900" borderRadius="md" overflow="hidden">
      <Flex
        justify="space-between"
        align="center"
        p={2}
        bg="gray.800"
        cursor="pointer"
        onClick={onToggle}
      >
        <HStack>
          <Icon as={FiActivity} color="green.400" />
          <Text fontWeight="bold" fontSize="sm" color="white">Activity Log</Text>
          <Badge colorScheme="green" fontSize="xs">{allLogs.length} entries</Badge>
        </HStack>
        <HStack>
          {allLogs.length > 0 && (
            <Tooltip label="Download Logs" fontSize="xs">
              <IconButton
                aria-label="Download logs"
                icon={<FiDownload size={14} />}
                size="xs"
                variant="ghost"
                colorScheme="green"
                onClick={handleDownloadLogs}
              />
            </Tooltip>
          )}
          <Icon as={isOpen ? FiChevronUp : FiChevronDown} color="white" />
        </HStack>
      </Flex>

      <Collapse in={isOpen}>
        <Box
          ref={logRef}
          maxH="150px"
          overflowY="auto"
          p={2}
          fontFamily="mono"
          fontSize="xs"
          css={{
            '&::-webkit-scrollbar': { width: '6px' },
            '&::-webkit-scrollbar-thumb': { background: 'gray.600', borderRadius: '3px' },
          }}
        >
          {allLogs.map((log, i) => (
            <Text key={i} color="green.300" mb={0.5}>
              {log}
            </Text>
          ))}
          {allLogs.length === 0 && (
            <Text color="gray.500">Waiting for activity...</Text>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

export function SyncDialog() {
  const toast = useToast()
  const activeDialog = useUIStore((state) => state.activeDialog)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const connections = useConnectionStore((state) => state.connections)

  const isOpen = activeDialog === 'sync'

  // State
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [destinationIds, setDestinationIds] = useState<string[]>([])
  const [options, setOptions] = useState<SyncOptions>({
    workspaces: true,
    datastores: true,
    coveragestores: true,
    layers: true,
    styles: true,
    layergroups: true,
  })
  const [hoveredSource, setHoveredSource] = useState(false)
  const [configName, setConfigName] = useState('')
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null)

  // Queries
  const { data: syncConfigs = [], refetch: refetchConfigs } = useQuery({
    queryKey: ['syncConfigs'],
    queryFn: api.getSyncConfigs,
    enabled: isOpen,
  })

  const { data: runningTasks = [], refetch: refetchTasks } = useQuery({
    queryKey: ['syncStatus'],
    queryFn: api.getSyncStatus,
    enabled: isOpen,
    refetchInterval: 1000, // Poll every second when dialog is open
  })

  // Check if any syncs are running
  const isAnyRunning = runningTasks.some(t => t.status === 'running')

  // Mutations
  const startSyncMutation = useMutation({
    mutationFn: (request: StartSyncRequest) => api.startSync(request),
    onSuccess: () => {
      toast({
        title: 'Sync started',
        description: 'Synchronization has been initiated.',
        status: 'success',
        duration: 3000,
      })
      refetchTasks()
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to start sync',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    },
  })

  const stopSyncMutation = useMutation({
    mutationFn: (taskId: string) => api.stopSyncTask(taskId),
    onSuccess: () => {
      toast({
        title: 'Sync stopped',
        status: 'info',
        duration: 2000,
      })
      refetchTasks()
    },
  })

  const stopAllMutation = useMutation({
    mutationFn: api.stopAllSyncs,
    onSuccess: () => {
      toast({
        title: 'All syncs stopped',
        status: 'info',
        duration: 2000,
      })
      refetchTasks()
    },
  })

  const saveSyncConfigMutation = useMutation({
    mutationFn: (config: Omit<SyncConfiguration, 'id' | 'created_at'>) => api.createSyncConfig(config),
    onSuccess: () => {
      toast({
        title: 'Configuration saved',
        status: 'success',
        duration: 2000,
      })
      refetchConfigs()
      setConfigName('')
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to save configuration',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    },
  })

  const deleteSyncConfigMutation = useMutation({
    mutationFn: (id: string) => api.deleteSyncConfig(id),
    onSuccess: () => {
      toast({
        title: 'Configuration deleted',
        status: 'info',
        duration: 2000,
      })
      refetchConfigs()
      setSelectedConfigId(null)
    },
  })

  // Handlers
  const handleStartSync = () => {
    if (!sourceId || destinationIds.length === 0) {
      toast({
        title: 'Configuration incomplete',
        description: 'Please select a source and at least one destination.',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    startSyncMutation.mutate({
      sourceId,
      destinationIds,
      options,
    })
  }

  const handleSaveConfig = () => {
    if (!configName || !sourceId || destinationIds.length === 0) {
      toast({
        title: 'Cannot save',
        description: 'Please provide a name and complete the sync configuration.',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    saveSyncConfigMutation.mutate({
      name: configName,
      source_id: sourceId,
      destination_ids: destinationIds,
      options,
    })
  }

  const handleLoadConfig = (config: SyncConfiguration) => {
    console.log('Loading sync config:', config)
    console.log('Available connections:', connections.map(c => ({ id: c.id, name: c.name })))

    // Set source - ensure it's a valid string or null
    const newSourceId = config.source_id && config.source_id.trim() !== '' ? config.source_id : null
    setSourceId(newSourceId)

    // Set destinations - filter out empty strings
    const newDestIds = (config.destination_ids || []).filter(id => id && id.trim() !== '')
    setDestinationIds(newDestIds)

    // Merge config options with defaults to ensure all fields exist
    const defaultOptions: SyncOptions = {
      workspaces: true,
      datastores: true,
      coveragestores: true,
      layers: true,
      styles: true,
      layergroups: true,
    }
    setOptions({ ...defaultOptions, ...(config.options || {}) })
    setSelectedConfigId(config.id)
    setConfigName(config.name)

    // Show toast if source/dest connections not found
    const sourceConn = newSourceId ? connections.find(c => c.id === newSourceId) : null
    const missingDests = newDestIds.filter(id => !connections.find(c => c.id === id))

    if (newSourceId && !sourceConn) {
      toast({
        title: 'Source connection not found',
        description: `The saved source connection (${newSourceId}) may have been deleted.`,
        status: 'warning',
        duration: 5000,
      })
    }
    if (missingDests.length > 0) {
      toast({
        title: 'Some destination connections not found',
        description: `${missingDests.length} destination(s) may have been deleted.`,
        status: 'warning',
        duration: 5000,
      })
    }
  }

  const handleAddDestination = (connId: string) => {
    if (connId === sourceId) {
      toast({
        title: 'Invalid selection',
        description: 'Cannot sync to the same server.',
        status: 'warning',
        duration: 2000,
      })
      return
    }
    if (!destinationIds.includes(connId)) {
      setDestinationIds([...destinationIds, connId])
    }
  }

  const handleRemoveDestination = (connId: string) => {
    setDestinationIds(destinationIds.filter(id => id !== connId))
  }

  // Get connection by ID
  const getConnection = (id: string) => connections.find(c => c.id === id)
  const sourceConnection = sourceId ? getConnection(sourceId) : null

  // Available servers for destination (excluding source)
  const availableDestinations = connections.filter(
    c => c.id !== sourceId && !destinationIds.includes(c.id)
  )

  // Get task for a destination
  const getTaskForDest = (destId: string) =>
    runningTasks.find(t => t.destId === destId && t.sourceId === sourceId)

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="6xl" scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(4px)" />
      <ModalContent maxH="90vh">
        <ModalHeader
          bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
          color="white"
          borderTopRadius="md"
        >
          <HStack>
            <Icon as={FiRefreshCw} />
            <Text>Sync Servers</Text>
          </HStack>
          <Text fontSize="sm" fontWeight="normal" opacity={0.9}>
            Replicate resources between GeoServer instances
          </Text>
        </ModalHeader>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={6} align="stretch">
            {/* Saved Configurations */}
            {syncConfigs.length > 0 && (
              <Box>
                <FormControl>
                  <FormLabel fontSize="sm" fontWeight="bold">
                    <HStack>
                      <Icon as={FiSave} />
                      <Text>Saved Configurations</Text>
                    </HStack>
                  </FormLabel>
                  <HStack>
                    <Select
                      placeholder="Select a saved configuration..."
                      value={selectedConfigId || ''}
                      onChange={(e) => {
                        const config = syncConfigs.find(c => c.id === e.target.value)
                        if (config) handleLoadConfig(config)
                      }}
                      size="sm"
                    >
                      {syncConfigs.map(config => (
                        <option key={config.id} value={config.id}>
                          {config.name} (Last sync: {config.last_synced_at || 'Never'})
                        </option>
                      ))}
                    </Select>
                    {selectedConfigId && (
                      <Tooltip label="Delete configuration">
                        <IconButton
                          aria-label="Delete configuration"
                          icon={<FiTrash2 />}
                          size="sm"
                          colorScheme="red"
                          variant="ghost"
                          onClick={() => deleteSyncConfigMutation.mutate(selectedConfigId)}
                        />
                      </Tooltip>
                    )}
                  </HStack>
                </FormControl>
              </Box>
            )}

            {/* Main Sync Panel */}
            <Flex gap={4} align="stretch" wrap="wrap" justify="center">
              {/* Source Panel */}
              <Box flex="1" minW="250px">
                <Text fontWeight="bold" fontSize="sm" mb={2} color="green.600">
                  <HStack>
                    <Icon as={FiArrowRight} />
                    <Text>Source (Read Only)</Text>
                  </HStack>
                </Text>
                <VStack spacing={3}>
                  <Select
                    placeholder="Select source server..."
                    value={sourceId || ''}
                    onChange={(e) => setSourceId(e.target.value || null)}
                    size="sm"
                  >
                    {connections.map(conn => (
                      <option key={conn.id} value={conn.id}>{conn.name}</option>
                    ))}
                  </Select>

                  {sourceConnection && (
                    <SourceServer
                      connection={sourceConnection}
                      isSelected={true}
                      onSelect={() => {}}
                      isHovered={hoveredSource}
                      onHover={setHoveredSource}
                    />
                  )}
                </VStack>
              </Box>

              {/* Connector */}
              <Flex align="center" minW="100px" justify="center">
                <ConnectorLine isActive={isAnyRunning} />
              </Flex>

              {/* Destination Panel */}
              <Box flex="2" minW="350px">
                <Text fontWeight="bold" fontSize="sm" mb={2} color="blue.600">
                  <HStack>
                    <Icon as={FiArrowLeft} />
                    <Text>Destinations (Receivers)</Text>
                  </HStack>
                </Text>

                {/* Add destination dropdown */}
                <HStack mb={3}>
                  <Select
                    placeholder="Add destination server..."
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddDestination(e.target.value)
                        e.target.value = ''
                      }
                    }}
                    size="sm"
                    isDisabled={!sourceId || availableDestinations.length === 0}
                  >
                    {availableDestinations.map(conn => (
                      <option key={conn.id} value={conn.id}>{conn.name}</option>
                    ))}
                  </Select>
                </HStack>

                {/* Destination cards */}
                {destinationIds.length > 0 ? (
                  <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={3}>
                    {destinationIds.map(destId => {
                      const conn = getConnection(destId)
                      if (!conn) return null
                      const task = getTaskForDest(destId)
                      const isRunning = task?.status === 'running'

                      return (
                        <DestinationServer
                          key={destId}
                          connection={conn}
                          isRunning={isRunning}
                          task={task}
                          onRemove={() => handleRemoveDestination(destId)}
                          onStop={() => task && stopSyncMutation.mutate(task.id)}
                        />
                      )
                    })}
                  </SimpleGrid>
                ) : (
                  <Box
                    p={8}
                    border="2px dashed"
                    borderColor="gray.300"
                    borderRadius="lg"
                    textAlign="center"
                  >
                    <Icon as={FiPlusCircle} w={10} h={10} color="gray.300" mb={2} />
                    <Text color="gray.500" fontSize="sm">
                      Select destination servers from the dropdown above
                    </Text>
                  </Box>
                )}
              </Box>
            </Flex>

            <Divider />

            {/* Sync Options */}
            <SyncOptionsPanel options={options} onChange={setOptions} />

            {/* Activity Log */}
            <SyncLogPanel tasks={runningTasks} />

            {/* Save Configuration */}
            <Box bg="gray.50" borderRadius="md" p={3}>
              <FormControl>
                <FormLabel fontSize="sm" fontWeight="bold">
                  <HStack>
                    <Icon as={FiSave} color="kartoza.500" />
                    <Text>Save Configuration</Text>
                  </HStack>
                </FormLabel>
                <HStack>
                  <Input
                    placeholder="Configuration name..."
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    size="sm"
                  />
                  <Button
                    leftIcon={<FiSave />}
                    colorScheme="kartoza"
                    size="sm"
                    onClick={handleSaveConfig}
                    isDisabled={!configName || !sourceId || destinationIds.length === 0}
                    isLoading={saveSyncConfigMutation.isPending}
                  >
                    Save
                  </Button>
                </HStack>
              </FormControl>
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter borderTop="1px" borderColor="gray.200" bg="gray.50">
          <HStack spacing={3} w="100%" justify="space-between">
            {/* Stop all button */}
            {isAnyRunning && (
              <Button
                leftIcon={<FiX />}
                colorScheme="red"
                variant="outline"
                onClick={() => stopAllMutation.mutate()}
                isLoading={stopAllMutation.isPending}
              >
                Stop All
              </Button>
            )}

            <HStack spacing={3} ml="auto">
              <Button variant="ghost" onClick={closeDialog}>
                Close
              </Button>
              <Button
                leftIcon={isAnyRunning ? <Spinner size="sm" /> : <FiPlay />}
                colorScheme="kartoza"
                size="lg"
                onClick={handleStartSync}
                isDisabled={!sourceId || destinationIds.length === 0 || isAnyRunning}
                isLoading={startSyncMutation.isPending}
                px={8}
                _hover={{
                  transform: 'scale(1.02)',
                  boxShadow: 'lg',
                }}
                transition="all 0.2s ease"
              >
                {isAnyRunning ? 'Syncing...' : 'Start Sync'}
              </Button>
            </HStack>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

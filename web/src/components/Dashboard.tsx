import { useRef, useEffect, useState } from 'react'
import {
  Box,
  Flex,
  VStack,
  HStack,
  Text,
  Icon,
  Badge,
  Progress,
  Spinner,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Tooltip,
  IconButton,
  Button,
} from '@chakra-ui/react'
import { keyframes, css } from '@emotion/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FiServer,
  FiLayers,
  FiDatabase,
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
  FiRefreshCw,
  FiClock,
  FiHardDrive,
  FiActivity,
  FiTable,
  FiEye,
  FiEyeOff,
  FiSettings,
} from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import * as api from '../api/client'
import type { ServerStatus } from '../types'
import { useUIStore } from '../stores/uiStore'
import { useTreeStore } from '../stores/treeStore'

// Keyframe animations
const pulseKeyframes = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`

const spinKeyframes = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Simple Sparkline component using SVG
interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
}

function Sparkline({ data, width = 80, height = 20, color = '#38B2AC' }: SparklineProps) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} style={{ display: 'inline-block', marginLeft: '4px' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Store ping history for sparklines
const pingHistoryMap = new Map<string, number[]>()
const MAX_PING_HISTORY = 30

function addPingToHistory(connectionId: string, responseTimeMs: number) {
  const history = pingHistoryMap.get(connectionId) || []
  history.push(responseTimeMs)
  if (history.length > MAX_PING_HISTORY) {
    history.shift()
  }
  pingHistoryMap.set(connectionId, history)
}

function getPingHistory(connectionId: string): number[] {
  return pingHistoryMap.get(connectionId) || []
}

// Store for tracking online status of PG services (lazy checked)
const pgOnlineStatusMap = new Map<string, { online: boolean | null; lastChecked: number }>()
const PG_STATUS_CACHE_MS = 60000 // Cache status for 60 seconds

// PostgreSQL Service Card
interface PGServiceCardProps {
  service: api.PGService
  onParse: () => Promise<void>
  isParsing: boolean
  onToggleHidden: (hidden: boolean) => Promise<void>
  isTogglingHidden: boolean
}

function PGServiceCard({ service, onParse, isParsing, onToggleHidden, isTogglingHidden }: PGServiceCardProps) {
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null)
  const [isCheckingOnline, setIsCheckingOnline] = useState(false)

  // Check online status lazily (only when card is visible and not recently checked)
  useEffect(() => {
    const cached = pgOnlineStatusMap.get(service.name)
    const now = Date.now()

    if (cached && now - cached.lastChecked < PG_STATUS_CACHE_MS) {
      setOnlineStatus(cached.online)
      return
    }

    // Don't check hidden services automatically
    if (service.hidden) {
      setOnlineStatus(null)
      return
    }

    // Check status in background
    const checkStatus = async () => {
      setIsCheckingOnline(true)
      try {
        const result = await api.testPGService(service.name)
        setOnlineStatus(result.success)
        pgOnlineStatusMap.set(service.name, { online: result.success, lastChecked: now })
      } catch {
        setOnlineStatus(false)
        pgOnlineStatusMap.set(service.name, { online: false, lastChecked: now })
      } finally {
        setIsCheckingOnline(false)
      }
    }

    checkStatus()
  }, [service.name, service.hidden])

  const bgColor = service.hidden ? 'gray.100' : service.is_parsed ? 'white' : 'gray.50'
  const borderColor = service.hidden ? 'gray.400' : onlineStatus === true ? 'green.400' : onlineStatus === false ? 'red.400' : service.is_parsed ? 'blue.400' : 'gray.300'

  // Status icon: online status takes priority, then parsed status
  const getStatusIcon = () => {
    if (service.hidden) return FiEyeOff
    if (onlineStatus === true) return FiCheckCircle
    if (onlineStatus === false) return FiXCircle
    return service.is_parsed ? FiCheckCircle : FiDatabase
  }

  const getStatusColor = () => {
    if (service.hidden) return 'gray.500'
    if (onlineStatus === true) return 'green.500'
    if (onlineStatus === false) return 'red.500'
    return service.is_parsed ? 'blue.500' : 'gray.400'
  }

  const getStatusLabel = () => {
    if (service.hidden) return 'Hidden (disabled)'
    if (isCheckingOnline) return 'Checking...'
    if (onlineStatus === true) return 'Online'
    if (onlineStatus === false) return 'Offline'
    return service.is_parsed ? 'Schema Parsed' : 'Not Parsed'
  }

  return (
    <Box
      bg={bgColor}
      borderRadius="xl"
      border="2px solid"
      borderColor={borderColor}
      p={4}
      minH="220px"
      position="relative"
      transition="all 0.3s ease"
      opacity={service.hidden ? 0.7 : 1}
      _hover={{
        transform: 'translateY(-2px)',
        boxShadow: 'lg',
      }}
    >
      {/* Status indicator and hide button */}
      <HStack
        position="absolute"
        top={3}
        right={3}
        spacing={2}
      >
        <Tooltip label={service.hidden ? 'Show service' : 'Hide service'}>
          <IconButton
            aria-label={service.hidden ? 'Show' : 'Hide'}
            icon={<Icon as={service.hidden ? FiEye : FiEyeOff} />}
            size="xs"
            variant="ghost"
            colorScheme={service.hidden ? 'blue' : 'gray'}
            onClick={() => onToggleHidden(!service.hidden)}
            isLoading={isTogglingHidden}
          />
        </Tooltip>
        <Tooltip label={getStatusLabel()}>
          <span>
            {isCheckingOnline ? (
              <Spinner size="sm" color="blue.500" />
            ) : (
              <Icon
                as={getStatusIcon()}
                color={getStatusColor()}
                boxSize={5}
              />
            )}
          </span>
        </Tooltip>
      </HStack>

      {/* Service info */}
      <VStack align="start" spacing={3}>
        <HStack>
          <Icon as={SiPostgresql} color={service.hidden ? 'gray.400' : 'blue.600'} boxSize={6} />
          <VStack align="start" spacing={0}>
            <Text fontWeight="bold" fontSize="lg" noOfLines={1} color={service.hidden ? 'gray.500' : undefined}>
              {service.name}
            </Text>
            <Text fontSize="xs" color="gray.500" noOfLines={1}>
              {service.host ? `${service.host}:${service.port || '5432'}` : 'pg_service.conf entry'}
            </Text>
          </VStack>
        </HStack>

        {/* Database info */}
        {service.dbname && (
          <Badge colorScheme={service.hidden ? 'gray' : 'blue'} fontSize="xs">
            Database: {service.dbname}
          </Badge>
        )}

        {/* Stats or action */}
        {service.hidden ? (
          <Alert status="info" variant="subtle" borderRadius="md" py={2}>
            <AlertIcon boxSize={4} />
            <Text fontSize="sm">This service is hidden</Text>
          </Alert>
        ) : service.is_parsed ? (
          <SimpleGrid columns={2} spacing={2} w="100%">
            <Stat size="sm">
              <StatLabel fontSize="xs" color="gray.500">
                <HStack spacing={1}>
                  <Icon as={FiTable} boxSize={3} />
                  <Text>Status</Text>
                </HStack>
              </StatLabel>
              <StatNumber fontSize="md" color={onlineStatus === true ? 'green.600' : onlineStatus === false ? 'red.600' : 'blue.600'}>
                {onlineStatus === true ? 'Online' : onlineStatus === false ? 'Offline' : 'Parsed'}
              </StatNumber>
            </Stat>
            <Stat size="sm">
              <StatLabel fontSize="xs" color="gray.500">
                <HStack spacing={1}>
                  <Icon as={FiDatabase} boxSize={3} />
                  <Text>User</Text>
                </HStack>
              </StatLabel>
              <StatNumber fontSize="md" color="gray.600" noOfLines={1}>
                {service.user || 'N/A'}
              </StatNumber>
            </Stat>
          </SimpleGrid>
        ) : (
          <Button
            size="sm"
            colorScheme="blue"
            variant="outline"
            leftIcon={<FiDatabase />}
            onClick={onParse}
            isLoading={isParsing}
            loadingText="Parsing..."
            w="100%"
          >
            Parse Schema
          </Button>
        )}

        {/* SSL Mode */}
        {service.sslmode && (
          <HStack spacing={2} fontSize="xs" color="gray.500" w="100%">
            <Text>SSL: {service.sslmode}</Text>
          </HStack>
        )}
      </VStack>
    </Box>
  )
}

interface ServerCardProps {
  server: ServerStatus
  isAlert?: boolean
}

function ServerCard({ server, isAlert = false }: ServerCardProps) {
  const borderColor = server.online ? 'green.400' : 'red.400'
  const bgColor = isAlert ? 'red.50' : server.online ? 'white' : 'gray.50'
  const statusIcon = server.online ? FiCheckCircle : FiXCircle
  const statusColor = server.online ? 'green.500' : 'red.500'

  // Get ping history for this server
  const pingHistory = getPingHistory(server.connectionId)

  return (
    <Box
      bg={bgColor}
      borderRadius="xl"
      border="2px solid"
      borderColor={borderColor}
      p={4}
      minH="220px"
      position="relative"
      transition="all 0.3s ease"
      _hover={{
        transform: 'translateY(-2px)',
        boxShadow: 'lg',
      }}
      css={!server.online ? css`animation: ${pulseKeyframes} 2s ease-in-out infinite;` : undefined}
    >
      {/* Status indicator */}
      <Box
        position="absolute"
        top={3}
        right={3}
      >
        <Tooltip label={server.online ? 'Online' : server.error || 'Offline'}>
          <span>
            <Icon
              as={statusIcon}
              color={statusColor}
              boxSize={5}
            />
          </span>
        </Tooltip>
      </Box>

      {/* Server info */}
      <VStack align="start" spacing={3}>
        <HStack>
          <Icon as={FiServer} color="kartoza.500" boxSize={6} />
          <VStack align="start" spacing={0}>
            <Text fontWeight="bold" fontSize="lg" noOfLines={1}>
              {server.connectionName}
            </Text>
            <Text fontSize="xs" color="gray.500" noOfLines={1}>
              {server.url}
            </Text>
          </VStack>
        </HStack>

        {server.online ? (
          <>
            {/* Version badge */}
            {server.geoserverVersion && (
              <Badge colorScheme="blue" fontSize="xs">
                GeoServer {server.geoserverVersion}
              </Badge>
            )}

            {/* Stats grid */}
            <SimpleGrid columns={2} spacing={2} w="100%">
              <Stat size="sm">
                <StatLabel fontSize="xs" color="gray.500">
                  <HStack spacing={1}>
                    <Icon as={FiLayers} boxSize={3} />
                    <Text>Layers</Text>
                  </HStack>
                </StatLabel>
                <StatNumber fontSize="xl" color="purple.600">
                  {server.layerCount}
                </StatNumber>
              </Stat>

              <Stat size="sm">
                <StatLabel fontSize="xs" color="gray.500">
                  <HStack spacing={1}>
                    <Icon as={FiDatabase} boxSize={3} />
                    <Text>Stores</Text>
                  </HStack>
                </StatLabel>
                <StatNumber fontSize="xl" color="blue.600">
                  {server.dataStoreCount + server.coverageCount}
                </StatNumber>
              </Stat>
            </SimpleGrid>

            {/* Memory usage */}
            {server.memoryTotal > 0 && (
              <Box w="100%">
                <HStack justify="space-between" mb={1}>
                  <HStack spacing={1}>
                    <Icon as={FiHardDrive} boxSize={3} color="gray.500" />
                    <Text fontSize="xs" color="gray.500">Memory</Text>
                  </HStack>
                  <Text fontSize="xs" color="gray.600">
                    {formatBytes(server.memoryUsed)} / {formatBytes(server.memoryTotal)}
                  </Text>
                </HStack>
                <Progress
                  value={server.memoryUsedPct}
                  size="sm"
                  colorScheme={server.memoryUsedPct > 80 ? 'red' : server.memoryUsedPct > 60 ? 'yellow' : 'green'}
                  borderRadius="full"
                />
              </Box>
            )}

            {/* Response time with sparkline */}
            <HStack spacing={2} fontSize="xs" color="gray.500" w="100%">
              <Icon as={FiClock} boxSize={3} />
              <Text>Response: {server.responseTimeMs}ms</Text>
              {pingHistory.length >= 2 && (
                <Sparkline data={pingHistory} width={60} height={16} color="#38B2AC" />
              )}
            </HStack>
          </>
        ) : (
          <Box w="100%">
            <Alert status="error" variant="subtle" borderRadius="md" py={2}>
              <AlertIcon boxSize={4} />
              <Text fontSize="sm" noOfLines={2}>
                {server.error || 'Server is offline'}
              </Text>
            </Alert>
          </Box>
        )}
      </VStack>
    </Box>
  )
}

export default function Dashboard() {
  const pingIntervalRef = useRef<number>(30)
  const queryClient = useQueryClient()
  const [parsingService, setParsingService] = useState<string | null>(null)
  const [togglingHiddenService, setTogglingHiddenService] = useState<string | null>(null)

  // Settings
  const showHiddenPGServices = useUIStore((state) => state.settings.showHiddenPGServices)
  const openDialog = useUIStore((state) => state.openDialog)

  // Get selected node to filter dashboard view
  const selectedNode = useTreeStore((state) => state.selectedNode)

  // Determine which sections to show based on selected node
  const getViewFilter = (): 'all' | 'geoserver' | 'postgresql' => {
    if (!selectedNode) return 'all'

    const nodeType = selectedNode.type
    // Show only GeoServer if a GeoServer-related node is selected
    if (nodeType === 'geoserver' || nodeType === 'connection' || nodeType === 'workspace' ||
        nodeType === 'datastores' || nodeType === 'coveragestores' || nodeType === 'datastore' ||
        nodeType === 'coveragestore' || nodeType === 'layers' || nodeType === 'layer' ||
        nodeType === 'styles' || nodeType === 'style' || nodeType === 'layergroups' || nodeType === 'layergroup') {
      return 'geoserver'
    }
    // Show only PostgreSQL if a PostgreSQL-related node is selected
    if (nodeType === 'postgresql' || nodeType === 'pgservice' || nodeType === 'pgschema' ||
        nodeType === 'pgtable' || nodeType === 'pgview' || nodeType === 'pgcolumn') {
      return 'postgresql'
    }
    // Default: show all (CloudBench root or unknown)
    return 'all'
  }

  const viewFilter = getViewFilter()

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    refetchInterval: () => pingIntervalRef.current * 1000, // Use dynamic interval
  })

  // Fetch PostgreSQL services
  const { data: pgServices } = useQuery({
    queryKey: ['pgservices'],
    queryFn: api.getPGServices,
    staleTime: 30000,
  })

  // Filter services based on settings
  const filteredPGServices = pgServices?.filter(
    (service) => showHiddenPGServices || !service.hidden
  )

  // Handle parsing a PG service
  const handleParsePGService = async (serviceName: string) => {
    setParsingService(serviceName)
    try {
      await api.parsePGService(serviceName)
      queryClient.invalidateQueries({ queryKey: ['pgservices'] })
    } catch (err) {
      console.error('Failed to parse service:', err)
    } finally {
      setParsingService(null)
    }
  }

  // Handle toggling hidden state for a PG service
  const handleToggleHidden = async (serviceName: string, hidden: boolean) => {
    setTogglingHiddenService(serviceName)
    try {
      await api.setPGServiceHidden(serviceName, hidden)
      // Clear cached online status when hiding/showing
      pgOnlineStatusMap.delete(serviceName)
      queryClient.invalidateQueries({ queryKey: ['pgservices'] })
    } catch (err) {
      console.error('Failed to toggle hidden state:', err)
    } finally {
      setTogglingHiddenService(null)
    }
  }

  // Update ping history when data changes
  useEffect(() => {
    if (data?.servers) {
      for (const server of data.servers) {
        if (server.online) {
          addPingToHistory(server.connectionId, server.responseTimeMs)
        }
      }
      // Update ping interval from server response
      if (data.pingIntervalSecs && data.pingIntervalSecs > 0) {
        pingIntervalRef.current = data.pingIntervalSecs
      }
    }
  }, [data])

  if (isLoading) {
    return (
      <Flex h="100%" align="center" justify="center">
        <VStack spacing={4}>
          <Spinner size="xl" color="kartoza.500" thickness="4px" />
          <Text color="gray.500">Loading server status...</Text>
        </VStack>
      </Flex>
    )
  }

  if (error) {
    return (
      <Flex h="100%" align="center" justify="center" p={8}>
        <Alert status="error" borderRadius="lg">
          <AlertIcon />
          <AlertTitle>Failed to load dashboard</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      </Flex>
    )
  }

  const hasGeoServers = data && data.servers.length > 0
  const hasPGServices = filteredPGServices && filteredPGServices.length > 0

  // Apply view filter
  const showGeoServerSection = (viewFilter === 'all' || viewFilter === 'geoserver') && hasGeoServers
  const showPGSection = (viewFilter === 'all' || viewFilter === 'postgresql') && hasPGServices

  if (!hasGeoServers && !hasPGServices) {
    return (
      <Flex h="100%" align="center" justify="center" p={8}>
        <VStack spacing={4} textAlign="center">
          <Icon as={FiServer} boxSize={16} color="gray.300" />
          <Text color="gray.500" fontSize="lg">No servers configured</Text>
          <Text color="gray.400" fontSize="sm">
            Add a GeoServer connection or PostgreSQL service to get started
          </Text>
        </VStack>
      </Flex>
    )
  }

  // Separate alert servers from healthy ones
  const healthyServers = data?.servers.filter(s => s.online) || []
  const alertServers = data?.servers.filter(s => !s.online) || []

  return (
    <Flex h="100%" direction="column">
      {/* Header with refresh button - fixed at top */}
      <Flex
        justify="space-between"
        align="center"
        p={4}
        borderBottom="1px solid"
        borderColor="gray.200"
        bg="white"
        flexShrink={0}
      >
        <HStack spacing={3}>
          <Icon as={FiActivity} boxSize={6} color="kartoza.500" />
          <Text fontSize="xl" fontWeight="bold">Server Dashboard</Text>
        </HStack>
        <HStack spacing={4}>
          {/* Summary stats */}
          <HStack spacing={6} display={{ base: 'none', md: 'flex' }}>
            <HStack spacing={2}>
              <Icon as={FiCheckCircle} color="green.500" />
              <Text fontWeight="bold" color="green.600">{data?.onlineCount || 0}</Text>
              <Text color="gray.500">Online</Text>
            </HStack>
            {(data?.offlineCount || 0) > 0 && (
              <HStack spacing={2}>
                <Icon as={FiXCircle} color="red.500" />
                <Text fontWeight="bold" color="red.600">{data?.offlineCount || 0}</Text>
                <Text color="gray.500">Offline</Text>
              </HStack>
            )}
            <HStack spacing={2}>
              <Icon as={FiLayers} color="purple.500" />
              <Text fontWeight="bold" color="purple.600">{data?.totalLayers || 0}</Text>
              <Text color="gray.500">Layers</Text>
            </HStack>
            {hasPGServices && (
              <HStack spacing={2}>
                <Icon as={SiPostgresql} color="blue.600" />
                <Text fontWeight="bold" color="blue.600">{filteredPGServices?.length || 0}</Text>
                <Text color="gray.500">PG Services</Text>
              </HStack>
            )}
            <HStack spacing={2}>
              <Icon as={FiClock} color="gray.500" />
              <Text color="gray.500">{data?.pingIntervalSecs || 60}s</Text>
            </HStack>
          </HStack>
          <Tooltip label="Settings">
            <IconButton
              aria-label="Settings"
              icon={<FiSettings />}
              variant="ghost"
              colorScheme="gray"
              onClick={() => openDialog('settings')}
            />
          </Tooltip>
          <Tooltip label="Refresh status">
            <IconButton
              aria-label="Refresh"
              icon={<FiRefreshCw />}
              variant="ghost"
              colorScheme="kartoza"
              onClick={() => refetch()}
              css={isFetching ? css`animation: ${spinKeyframes} 1s linear infinite;` : undefined}
            />
          </Tooltip>
        </HStack>
      </Flex>

      {/* Scrollable content area with centered cards */}
      <Flex
        flex={1}
        overflowY="auto"
        p={6}
        justify="center"
        align={(data?.servers.length || 0) + (filteredPGServices?.length || 0) <= 3 ? 'center' : 'flex-start'}
      >
        <VStack spacing={6} maxW="1400px" w="100%">
          {/* GeoServer section */}
          {showGeoServerSection && (
            <Box w="100%">
              <HStack spacing={2} mb={3} justify="center">
                <Icon as={FiServer} color="kartoza.500" />
                <Text fontWeight="bold" color="gray.700">
                  GeoServer Connections ({data?.servers.length || 0})
                </Text>
              </HStack>

              {/* Alert section for offline/error servers */}
              {alertServers.length > 0 && (
                <Box mb={4}>
                  <HStack spacing={2} mb={2} justify="center">
                    <Icon as={FiAlertTriangle} color="red.500" boxSize={4} />
                    <Text fontSize="sm" fontWeight="medium" color="red.600">
                      Requires Attention ({alertServers.length})
                    </Text>
                  </HStack>
                  <Flex wrap="wrap" gap={4} justify="center">
                    {alertServers.map(server => (
                      <Box key={server.connectionId} w={{ base: '100%', md: '340px' }}>
                        <ServerCard server={server} isAlert />
                      </Box>
                    ))}
                  </Flex>
                </Box>
              )}

              {/* Healthy servers */}
              {healthyServers.length > 0 && (
                <Flex wrap="wrap" gap={4} justify="center">
                  {healthyServers.map(server => (
                    <Box key={server.connectionId} w={{ base: '100%', md: '340px' }}>
                      <ServerCard server={server} />
                    </Box>
                  ))}
                </Flex>
              )}
            </Box>
          )}

          {/* PostgreSQL Services section */}
          {showPGSection && (
            <Box w="100%">
              <HStack spacing={2} mb={3} justify="center">
                <Icon as={SiPostgresql} color="blue.600" />
                <Text fontWeight="bold" color="gray.700">
                  PostgreSQL Services ({filteredPGServices?.length || 0})
                </Text>
              </HStack>
              <Flex wrap="wrap" gap={4} justify="center">
                {filteredPGServices?.map(service => (
                  <Box key={service.name} w={{ base: '100%', md: '340px' }}>
                    <PGServiceCard
                      service={service}
                      onParse={() => handleParsePGService(service.name)}
                      isParsing={parsingService === service.name}
                      onToggleHidden={(hidden) => handleToggleHidden(service.name, hidden)}
                      isTogglingHidden={togglingHiddenService === service.name}
                    />
                  </Box>
                ))}
              </Flex>
            </Box>
          )}
        </VStack>
      </Flex>
    </Flex>
  )
}

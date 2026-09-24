import { useEffect, useState, useMemo } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Box,
  Text,
  Spinner,
  Center,
  HStack,
  VStack,
  Badge,
  Icon,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Progress,
  Divider,
  Wrap,
  WrapItem,
  Tag,
  useColorModeValue,
  Tooltip,
} from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import {
  FiDatabase,
  FiServer,
  FiUsers,
  FiActivity,
  FiHardDrive,
  FiClock,
  FiTable,
  FiEye,
  FiCode,
  FiLayers,
  FiGlobe,
  FiMapPin,
  FiZap,
  FiCheckCircle,
  FiAlertCircle,
} from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import { useUIStore } from '../../stores/uiStore'
import { getPGServiceStats, type PGServerStats } from '../../api'

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

interface StatCardProps {
  label: string
  value: string | number
  helpText?: string
  icon: React.ElementType
  colorScheme?: string
}

function StatCard({ label, value, helpText, icon, colorScheme = 'blue' }: StatCardProps) {
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
  // Extract domain for display
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
    // Local - show at user's approximate location (defaulting to Europe/US)
    return { x: '48%', y: '35%' }
  }
  if (host.includes('kartoza.com')) {
    // Cape Town, South Africa
    return { x: '53%', y: '72%' }
  }
  // Default to central position
  return { x: '50%', y: '45%' }
}

// World map component with marker
function ServerLocationMap({ host }: { host: string }) {
  const mapBg = useColorModeValue('blue.50', 'blue.900')
  const landColor = useColorModeValue('#D1D1D1', '#676869')
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
        {/* World map with continent outlines */}
        <svg
          viewBox="0 0 900 400"
          style={{ width: '100%', height: '100%' }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Ocean grid lines for effect */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Continent outlines */}
          <path
            d={WORLD_MAP_PATH}
            fill={landColor}
            stroke={landColor}
            strokeWidth="2"
            opacity="0.6"
          />
        </svg>

        {/* Server location marker with pulse animation */}
        <Box
          position="absolute"
          left={markerPos.x}
          top={markerPos.y}
          transform="translate(-50%, -50%)"
        >
          {/* Pulsing rings */}
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
          {/* Center dot */}
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

        {/* Host label overlay */}
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

      {/* Location description text */}
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

export default function PGServiceDashboardDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)

  const isOpen = activeDialog === 'pgdashboard'
  const data = dialogData?.data as {
    serviceName?: string
  } | undefined

  const [stats, setStats] = useState<PGServerStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Colors
  const bodyBg = useColorModeValue('gray.50', 'gray.900')

  useEffect(() => {
    if (isOpen && data?.serviceName) {
      setLoading(true)
      setError(null)
      getPGServiceStats(data.serviceName)
        .then(setStats)
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [isOpen, data?.serviceName])

  // Parse PostgreSQL version
  const pgVersionShort = useMemo(() => {
    if (!stats?.version) return 'Unknown'
    const match = stats.version.match(/PostgreSQL (\d+\.\d+)/)
    return match ? `PostgreSQL ${match[1]}` : 'PostgreSQL'
  }, [stats?.version])

  if (!data?.serviceName) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeDialog}
      size="5xl"
      motionPreset="slideInBottom"
    >
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent
        m={4}
        borderRadius="2xl"
        overflow="hidden"
        maxH="90vh"
        bg={bodyBg}
      >
        <ModalHeader
          bg="surface.header"
          color="white"
          py={6}
          px={6}
        >
          <HStack spacing={4}>
            <Box
              p={3}
              bg="whiteAlpha.200"
              borderRadius="xl"
            >
              <Icon as={SiPostgresql} boxSize={8} />
            </Box>
            <VStack align="start" spacing={0}>
              <HStack spacing={3}>
                <Text fontSize="xl" fontWeight="bold">
                  {data.serviceName}
                </Text>
                {stats && (
                  <Badge
                    colorScheme="green"
                    variant="solid"
                    fontSize="xs"
                    px={2}
                    py={1}
                    borderRadius="sm"
                  >
                    <HStack spacing={1}>
                      <Icon as={FiCheckCircle} boxSize={3} />
                      <Text>Connected</Text>
                    </HStack>
                  </Badge>
                )}
              </HStack>
              {stats && (
                <HStack spacing={3} opacity={0.9} mt={1}>
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
              )}
            </VStack>
          </HStack>
        </ModalHeader>
        <ModalCloseButton color="white" />

        <ModalBody p={6} overflowY="auto" maxH="calc(90vh - 100px)">
          {loading ? (
            <Center h="300px">
              <VStack spacing={4}>
                <Spinner size="xl" color="blue.500" thickness="4px" />
                <Text color="gray.500">Loading server statistics...</Text>
              </VStack>
            </Center>
          ) : error ? (
            <Center h="300px">
              <VStack spacing={4}>
                <Icon as={FiAlertCircle} boxSize={12} color="red.500" />
                <Text color="red.500" fontWeight="medium">{error}</Text>
              </VStack>
            </Center>
          ) : stats && (
            <VStack spacing={6} align="stretch">
              {/* Server Location Map */}
              <ServerLocationMap host={stats.host} />

              {/* Connection Stats */}
              <Box>
                <HStack mb={4}>
                  <Icon as={FiUsers} color="purple.500" />
                  <Text fontWeight="semibold" fontSize="lg">Connections</Text>
                </HStack>
                <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
                  <StatCard
                    label="Current"
                    value={stats.current_connections}
                    helpText={`of ${stats.max_connections} max`}
                    icon={FiUsers}
                    colorScheme="purple"
                  />
                  <StatCard
                    label="Active"
                    value={stats.active_connections}
                    helpText="executing queries"
                    icon={FiActivity}
                    colorScheme="green"
                  />
                  <StatCard
                    label="Idle"
                    value={stats.idle_connections}
                    helpText="waiting for work"
                    icon={FiClock}
                    colorScheme="blue"
                  />
                  <StatCard
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
                    borderRadius="sm"
                    size="lg"
                  />
                </Box>
              </Box>

              <Divider />

              {/* Database Stats */}
              <Box>
                <HStack mb={4}>
                  <Icon as={FiDatabase} color="blue.500" />
                  <Text fontWeight="semibold" fontSize="lg">Database</Text>
                </HStack>
                <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
                  <StatCard
                    label="Size"
                    value={stats.database_size}
                    icon={FiHardDrive}
                    colorScheme="blue"
                  />
                  <StatCard
                    label="Cache Hit Ratio"
                    value={stats.cache_hit_ratio}
                    helpText="higher is better"
                    icon={FiZap}
                    colorScheme="green"
                  />
                  <StatCard
                    label="Live Tuples"
                    value={stats.live_tuples.toLocaleString()}
                    icon={FiTable}
                    colorScheme="purple"
                  />
                  <StatCard
                    label="Dead Tuples"
                    value={stats.dead_tuples.toLocaleString()}
                    helpText="needs vacuum"
                    icon={FiAlertCircle}
                    colorScheme={stats.dead_tuples > 10000 ? 'red' : 'gray'}
                  />
                </SimpleGrid>
              </Box>

              <Divider />

              {/* Object Counts */}
              <Box>
                <HStack mb={4}>
                  <Icon as={FiLayers} color="teal.500" />
                  <Text fontWeight="semibold" fontSize="lg">Objects</Text>
                </HStack>
                <SimpleGrid columns={{ base: 3, md: 5 }} spacing={4}>
                  <StatCard
                    label="Schemas"
                    value={stats.schema_count}
                    icon={FiLayers}
                    colorScheme="teal"
                  />
                  <StatCard
                    label="Tables"
                    value={stats.table_count}
                    icon={FiTable}
                    colorScheme="blue"
                  />
                  <StatCard
                    label="Views"
                    value={stats.view_count}
                    icon={FiEye}
                    colorScheme="purple"
                  />
                  <StatCard
                    label="Indexes"
                    value={stats.index_count}
                    icon={FiZap}
                    colorScheme="orange"
                  />
                  <StatCard
                    label="Functions"
                    value={stats.function_count}
                    icon={FiCode}
                    colorScheme="pink"
                  />
                </SimpleGrid>
              </Box>

              {/* PostGIS Section */}
              {stats.has_postgis && (
                <>
                  <Divider />
                  <Box>
                    <HStack mb={4}>
                      <Icon as={FiGlobe} color="green.500" />
                      <Text fontWeight="semibold" fontSize="lg">PostGIS</Text>
                    </HStack>
                    <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
                      <StatCard
                        label="Geometry Columns"
                        value={stats.geometry_columns || 0}
                        icon={FiGlobe}
                        colorScheme="green"
                      />
                      <StatCard
                        label="Raster Columns"
                        value={stats.raster_columns || 0}
                        icon={FiLayers}
                        colorScheme="blue"
                      />
                    </SimpleGrid>
                    {stats.postgis_version && (
                      <Box mt={4} p={3} bg="green.50" borderRadius="lg">
                        <Text fontSize="xs" color="green.700" fontFamily="mono" noOfLines={2}>
                          {stats.postgis_version}
                        </Text>
                      </Box>
                    )}
                  </Box>
                </>
              )}

              <Divider />

              {/* Server Info */}
              <Box>
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
              </Box>

              {/* Extensions */}
              {stats.installed_extensions && stats.installed_extensions.length > 0 && (
                <>
                  <Divider />
                  <Box>
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
                              borderRadius="sm"
                            >
                              {ext}
                            </Tag>
                          </Tooltip>
                        </WrapItem>
                      ))}
                    </Wrap>
                  </Box>
                </>
              )}
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

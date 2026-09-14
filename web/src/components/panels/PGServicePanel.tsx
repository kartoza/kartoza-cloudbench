import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Center,
  Heading,
  HStack,
  Icon,
  Progress,
  SimpleGrid,
  Spinner,
  Stat,
  StatHelpText,
  StatLabel,
  StatNumber,
  Tag,
  Text,
  Tooltip,
  useColorModeValue,
  VStack,
  Wrap,
  WrapItem,
} from '@chakra-ui/react'
import {
  FiActivity,
  FiAlertCircle,
  FiCheckCircle,
  FiClock,
  FiCode,
  FiDatabase,
  FiEye,
  FiGlobe,
  FiHardDrive,
  FiLayers,
  FiServer,
  FiTable,
  FiUpload,
  FiUsers,
  FiZap,
} from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import ServerLocationMap from '../common/ServerLocationMap'
import { Panel } from "../Panel";
import { PanelHeader } from "../Panel/PanelHeader";
import { PanelBody } from "../Panel/PanelBody";

interface PGStatCardProps {
  label: string
  value: string | number
  helpText?: string
  icon: React.ElementType
  colorScheme?: string
}

function PGStatCard(
  {
    label,
    value,
    helpText,
    icon,
    colorScheme = 'blue'
  }: PGStatCardProps) {
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
          <Icon as={icon} boxSize={5}/>
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

interface PGServicePanelProps {
  serviceName: string
}

export default function PGServicePanel({ serviceName }: PGServicePanelProps) {
  const [stats, setStats] = useState<api.PGServerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const openDialog = useUIStore((state) => state.openDialog)
  const setPGQuery = useUIStore((state) => state.setPGQuery)

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
          <Spinner size="xl" color="blue.500" thickness="4px"/>
          <Text color="gray.500">Loading server statistics...</Text>
        </VStack>
      </Center>
    )
  }

  if (error) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Icon as={FiAlertCircle} boxSize={12} color="red.500"/>
          <Text color="red.500" fontWeight="medium">{error}</Text>
        </VStack>
      </Center>
    )
  }

  if (!stats) return null

  return (
    <Panel>
      {/* Header Card */}
      <PanelHeader>
        <HStack spacing={4}>
          <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
            <Icon as={SiPostgresql} boxSize={8}/>
          </Box>
          <VStack align="start" spacing={1}>
            <HStack spacing={3}>
              <Heading size="lg" color="white">{serviceName}</Heading>
              <Badge
                colorScheme="green"
                variant="solid"
                fontSize="xs"
                px={2}
                py={1}
                borderRadius="full"
              >
                <HStack spacing={1}>
                  <Icon as={FiCheckCircle} boxSize={3}/>
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
                    <Icon as={FiGlobe} boxSize={4}/>
                    <Text fontSize="sm">PostGIS</Text>
                  </HStack>
                </>
              )}
            </HStack>
          </VStack>
        </HStack>
        <HStack wrap="wrap" gap={2}>
          <Button
            variant="solid"
            bg="whiteAlpha.200"
            color="white"
            _hover={{ bg: 'whiteAlpha.300' }}
            leftIcon={<FiCode/>}
            onClick={() => setPGQuery({
              serviceName,
            })}
          >
            SQL Query
          </Button>
          <Button
            variant="outline"
            color="white"
            borderColor="whiteAlpha.400"
            _hover={{ bg: 'whiteAlpha.200' }}
            leftIcon={<FiUpload/>}
            onClick={() => openDialog('pgupload', {
              mode: 'create',
              data: { serviceName },
            })}
          >
            Import Data
          </Button>
        </HStack>
      </PanelHeader>

      <PanelBody>
        {/* Server Location Map */}
        <ServerLocationMap host={stats.host}/>

        {/* Connection Stats */}
        <Card bg={cardBg}>
          <CardBody>
            <HStack mb={4}>
              <Icon as={FiUsers} color="purple.500"/>
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
                <Text fontSize="sm" color="gray.500">Connection Pool
                  Usage</Text>
                <Text fontSize="sm"
                      fontWeight="bold">{stats.connection_percent}%</Text>
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
              <Icon as={FiDatabase} color="blue.500"/>
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
              <Icon as={FiLayers} color="teal.500"/>
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
                <Icon as={FiGlobe} color="green.500"/>
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
                <Box mt={4} p={3} bg="green.50" borderRadius="lg"
                     _dark={{ bg: 'green.900' }}>
                  <Text fontSize="xs" color="green.700" fontFamily="mono"
                        noOfLines={2} _dark={{ color: 'green.200' }}>
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
              <Icon as={FiServer} color="gray.500"/>
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
            <Box mt={4} p={3} bg="gray.100" borderRadius="lg"
                 _dark={{ bg: 'gray.700' }}>
              <Text fontSize="xs" color="gray.600" fontFamily="mono"
                    noOfLines={2} _dark={{ color: 'gray.300' }}>
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
                <Icon as={FiCode} color="indigo.500"/>
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
      </PanelBody>
    </Panel>
  )
}

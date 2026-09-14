import { useEffect, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Center,
  Flex,
  Heading,
  HStack,
  Icon,
  SimpleGrid,
  Spinner,
  Text,
  Tooltip,
  useColorModeValue,
  VStack,
} from '@chakra-ui/react'
import {
  FiActivity,
  FiAlertCircle,
  FiCode,
  FiEye,
  FiGlobe,
  FiHardDrive,
  FiImage,
  FiLayers,
  FiTable,
  FiUpload,
  FiZap,
} from 'react-icons/fi'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
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

interface PGSchemaPanelProps {
  serviceName: string
  schemaName: string
}

export default function PGSchemaPanel(
  {
    serviceName,
    schemaName
  }: PGSchemaPanelProps) {
  const [stats, setStats] = useState<api.PGSchemaStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const openDialog = useUIStore((state) => state.openDialog)
  const setPGQuery = useUIStore((state) => state.setPGQuery)

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
          <Spinner size="xl" color="teal.500" thickness="4px"/>
          <Text color="gray.500">Loading schema statistics...</Text>
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
            <Icon as={FiLayers} boxSize={8}/>
          </Box>
          <VStack align="start" spacing={1}>
            <HStack spacing={3}>
              <Heading size="lg" color="white">{schemaName}</Heading>
            </HStack>
            <HStack spacing={3} opacity={0.9}>
              <Text fontSize="sm">{stats.database_name}</Text>
              <Text fontSize="sm">|</Text>
              <Text fontSize="sm">Owner: {stats.owner}</Text>
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
              schemaName,
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
              data: { serviceName, schemaName },
            })}
          >
            Import Data
          </Button>
        </HStack>
      </PanelHeader>

      <PanelBody>
        {/* Size and Stats Overview */}
        <Card bg={cardBg}>
          <CardBody>
            <HStack mb={4}>
              <Icon as={FiHardDrive} color="teal.500"/>
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
              <Icon as={FiLayers} color="purple.500"/>
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
                <Icon as={FiGlobe} color="green.500"/>
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
                <Icon as={FiTable} color="blue.500"/>
                <Text fontWeight="semibold" fontSize="lg">Tables
                  ({stats.tables.length})</Text>
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
                            <Badge colorScheme="blue" size="sm"
                                   variant="subtle">PK</Badge>
                          </Tooltip>
                        )}
                        {table.has_geometry && (
                          <Tooltip
                            label={`${table.geometry_type} (SRID: ${table.srid})`}>
                            <Badge colorScheme="green" size="sm"
                                   variant="subtle">
                              {table.geometry_type}
                            </Badge>
                          </Tooltip>
                        )}
                      </HStack>
                      <HStack spacing={4} fontSize="sm" color="gray.500">
                        <Tooltip label="Row count">
                          <HStack spacing={1}>
                            <Icon as={FiTable} boxSize={3}/>
                            <Text>{table.row_count.toLocaleString()} rows</Text>
                          </HStack>
                        </Tooltip>
                        <Tooltip label="Table size">
                          <HStack spacing={1}>
                            <Icon as={FiHardDrive} boxSize={3}/>
                            <Text>{table.size}</Text>
                          </HStack>
                        </Tooltip>
                        <Tooltip label="Index count">
                          <HStack spacing={1}>
                            <Icon as={FiZap} boxSize={3}/>
                            <Text>{table.index_count} idx</Text>
                          </HStack>
                        </Tooltip>
                        {table.dead_tuples > 0 && (
                          <Tooltip label="Dead tuples - consider VACUUM">
                            <HStack spacing={1}
                                    color={table.dead_tuples > 100 ? 'orange.500' : 'gray.500'}>
                              <Icon as={FiAlertCircle} boxSize={3}/>
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
                            <Icon as={FiEye}/>
                          </Button>
                        </Tooltip>
                        <Tooltip label="Query">
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="teal"
                            onClick={() => setPGQuery({
                              serviceName,
                              schemaName,
                              tableName: table.name,
                              initialSQL: `SELECT *
                                           FROM "${schemaName}"."${table.name}" LIMIT 100`,
                            })}
                          >
                            <Icon as={FiCode}/>
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
                <Icon as={FiEye} color="purple.500"/>
                <Text fontWeight="semibold" fontSize="lg">Views
                  ({stats.views.length})</Text>
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
                        <Icon as={FiEye} color="purple.500" boxSize={4}/>
                        <Text fontWeight="medium">{view.name}</Text>
                        {view.is_materialized && (
                          <Badge colorScheme="orange" size="sm"
                                 variant="subtle">
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
                            <Icon as={FiEye}/>
                          </Button>
                        </Tooltip>
                        <Tooltip label="Query">
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="teal"
                            onClick={() => setPGQuery({
                              serviceName,
                              schemaName,
                              tableName: view.name,
                              initialSQL: `SELECT *
                                           FROM "${schemaName}"."${view.name}" LIMIT 100`,
                            })}
                          >
                            <Icon as={FiCode}/>
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
      </PanelBody>
    </Panel>
  )
}

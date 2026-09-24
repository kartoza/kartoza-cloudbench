import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Card,
  Heading,
  Text,
  VStack,
  HStack,
  Badge,
  Spinner,
  IconButton,
  Tooltip,
  useColorModeValue,
  SimpleGrid,
  Collapse,
  Button,
  Alert,
  AlertIcon,
  AlertDescription,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Icon,
  Divider,
} from '@chakra-ui/react'
import { FiInfo, FiRefreshCw, FiX, FiMap, FiDatabase, FiPlay, FiCheck, FiClock, FiExternalLink } from 'react-icons/fi'
import { SiJupyter } from 'react-icons/si'
import { TbSnowflake } from 'react-icons/tb'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api'
import { useUIStore } from '../stores/uiStore'

interface IcebergTablePreviewProps {
  connectionId: string
  connectionName: string
  namespace: string
  tableName: string
  onClose?: () => void
}

export default function IcebergTablePreview({
  connectionId,
  connectionName,
  namespace,
  tableName,
  onClose,
}: IcebergTablePreviewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)

  const [showMetadata, setShowMetadata] = useState(true)
  const [showSchema, setShowSchema] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)

  const openDialog = useUIStore((state) => state.openDialog)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const metaBg = useColorModeValue('gray.50', 'gray.700')
  const theadBg = useColorModeValue('gray.100', 'gray.600')

  // Fetch connection details to get Jupyter URL
  const { data: connectionData } = useQuery({
    queryKey: ['icebergconnection', connectionId],
    queryFn: () => api.getIcebergConnection(connectionId),
  })

  // Fetch table metadata
  const { data: tableData, isLoading: tableLoading, error: tableError, refetch: refetchTable } = useQuery({
    queryKey: ['icebergtable', connectionId, namespace, tableName],
    queryFn: () => api.getIcebergTable(connectionId, namespace, tableName),
  })

  // Fetch schema
  const { data: schemaData, isLoading: schemaLoading } = useQuery({
    queryKey: ['icebergtableschema', connectionId, namespace, tableName],
    queryFn: () => api.getIcebergTableSchema(connectionId, namespace, tableName),
    enabled: showSchema,
  })

  // Fetch snapshots
  const { data: snapshotsData, isLoading: snapshotsLoading } = useQuery({
    queryKey: ['icebergsnapshots', connectionId, namespace, tableName],
    queryFn: () => api.getIcebergSnapshots(connectionId, namespace, tableName),
    enabled: showSnapshots,
  })

  // Initialize map placeholder
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    const newMap = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#F5F5F2',
            },
          },
        ],
      },
      center: [0, 20],
      zoom: 1,
      interactive: false, // Disable interactions for placeholder
    })

    map.current = newMap

    return () => {
      newMap.remove()
      map.current = null
    }
  }, [])

  const handleOpenQuery = () => {
    openDialog('icebergquery', {
      mode: 'create',
      data: {
        connectionId,
        connectionName,
        namespace,
        tableName,
      },
    })
  }

  const handleOpenJupyter = () => {
    if (connectionData?.jupyterUrl) {
      window.open(connectionData.jupyterUrl, '_blank')
    }
  }

  const handleRefresh = () => {
    refetchTable()
  }

  // Get type color for schema display
  const getTypeColor = (type: string) => {
    const lowerType = type.toLowerCase()
    if (lowerType.includes('int') || lowerType.includes('long') || lowerType.includes('decimal') || lowerType.includes('float') || lowerType.includes('double')) {
      return 'blue'
    }
    if (lowerType.includes('string') || lowerType.includes('varchar') || lowerType.includes('char')) {
      return 'green'
    }
    if (lowerType.includes('boolean')) {
      return 'purple'
    }
    if (lowerType.includes('timestamp') || lowerType.includes('date') || lowerType.includes('time')) {
      return 'orange'
    }
    if (lowerType.includes('geometry') || lowerType.includes('point') || lowerType.includes('polygon') || lowerType.includes('linestring')) {
      return 'cyan'
    }
    return 'gray'
  }

  const formatDate = (ms: number) => {
    return new Date(ms).toLocaleString()
  }

  const formatNumber = (num: number) => {
    return num.toLocaleString()
  }

  if (tableLoading) {
    return (
      <Card bg={cardBg} borderColor={borderColor} borderWidth="1px" h="100%" overflow="hidden">
        <VStack justify="center" align="center" h="100%" p={8}>
          <Spinner size="xl" color="cyan.500" thickness="3px" />
          <Text color="gray.500">Loading table metadata...</Text>
        </VStack>
      </Card>
    )
  }

  if (tableError) {
    return (
      <Card bg={cardBg} borderColor={borderColor} borderWidth="1px" h="100%" overflow="hidden">
        <VStack justify="center" align="center" h="100%" p={8}>
          <Alert status="error" borderRadius="lg">
            <AlertIcon />
            <AlertDescription>{(tableError as Error).message}</AlertDescription>
          </Alert>
        </VStack>
      </Card>
    )
  }

  return (
    <Card bg={cardBg} borderColor={borderColor} borderWidth="1px" h="100%" overflow="hidden">
      <VStack spacing={0} h="100%">
        {/* Header */}
        <HStack
          w="100%"
          px={4}
          py={3}
          borderBottomWidth="1px"
          borderBottomColor={borderColor}
          justify="space-between"
          bg="surface.header"
        >
          <HStack spacing={3}>
            <Icon as={TbSnowflake} boxSize={5} color="white" />
            <VStack align="start" spacing={0}>
              <Heading size="sm" color="white" noOfLines={1}>
                {tableName}
              </Heading>
              <Text fontSize="xs" color="whiteAlpha.800">
                {namespace} • {connectionName}
              </Text>
            </VStack>
          </HStack>
          <HStack spacing={1}>
            <Tooltip label="Toggle metadata">
              <IconButton
                aria-label="Toggle metadata"
                icon={<FiInfo />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={() => setShowMetadata(!showMetadata)}
              />
            </Tooltip>
            {connectionData?.jupyterUrl && (
              <Tooltip label="Open Jupyter Notebook">
                <IconButton
                  aria-label="Open Jupyter"
                  icon={<Icon as={SiJupyter} />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={handleOpenJupyter}
                />
              </Tooltip>
            )}
            <Tooltip label="Refresh">
              <IconButton
                aria-label="Refresh"
                icon={<FiRefreshCw />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleRefresh}
              />
            </Tooltip>
            {onClose && (
              <Tooltip label="Close preview">
                <IconButton
                  aria-label="Close"
                  icon={<FiX />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={onClose}
                />
              </Tooltip>
            )}
          </HStack>
        </HStack>

        {/* Badges */}
        {tableData && (
          <HStack w="100%" px={4} py={2} borderBottomWidth="1px" borderBottomColor={borderColor} spacing={2} flexWrap="wrap">
            {tableData.hasGeometry && (
              <Badge colorScheme="green" fontSize="xs">
                <HStack spacing={1}>
                  <Icon as={FiMap} boxSize={3} />
                  <Text>Spatial</Text>
                </HStack>
              </Badge>
            )}
            {tableData.formatVersion && (
              <Badge colorScheme="cyan" fontSize="xs">
                Iceberg v{tableData.formatVersion}
              </Badge>
            )}
            {tableData.rowCount !== undefined && (
              <Badge colorScheme="blue" fontSize="xs">
                {formatNumber(tableData.rowCount)} rows
              </Badge>
            )}
            {tableData.snapshotCount !== undefined && tableData.snapshotCount > 0 && (
              <Badge colorScheme="purple" fontSize="xs">
                {tableData.snapshotCount} snapshots
              </Badge>
            )}
          </HStack>
        )}

        {/* Map placeholder */}
        <Box flex={1} w="100%" position="relative" minH="200px">
          <Box ref={mapContainer} position="absolute" top={0} left={0} right={0} bottom={0} />

          {/* Overlay for placeholder message */}
          <Box
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            bg="blackAlpha.600"
            display="flex"
            alignItems="center"
            justifyContent="center"
            p={4}
          >
            <VStack spacing={4} maxW="400px" textAlign="center">
              <Icon as={FiMap} boxSize={12} color="cyan.300" />
              <Heading size="md" color="white">
                Spatial Preview
              </Heading>
              <Text color="whiteAlpha.800" fontSize="sm">
                {tableData?.hasGeometry
                  ? 'This table contains geometry data. Use SQL Query to visualize spatial features with Apache Sedona.'
                  : 'This table does not contain geometry columns.'}
              </Text>
              {tableData?.hasGeometry && tableData.geometryColumns && (
                <HStack spacing={2} flexWrap="wrap" justify="center">
                  {tableData.geometryColumns.map((col) => (
                    <Badge key={col} colorScheme="cyan" fontSize="xs">
                      {col}
                    </Badge>
                  ))}
                </HStack>
              )}
              <HStack spacing={3}>
                <Button
                  colorScheme="cyan"
                  leftIcon={<FiPlay />}
                  onClick={handleOpenQuery}
                  size="md"
                >
                  Open SQL Query
                </Button>
                {connectionData?.jupyterUrl && (
                  <Button
                    colorScheme="orange"
                    leftIcon={<Icon as={SiJupyter} />}
                    onClick={handleOpenJupyter}
                    size="md"
                    rightIcon={<FiExternalLink />}
                  >
                    Open Jupyter
                  </Button>
                )}
              </HStack>
            </VStack>
          </Box>
        </Box>

        {/* Metadata Panel */}
        <Collapse in={showMetadata} animateOpacity>
          <Box
            w="100%"
            bg={metaBg}
            p={4}
            borderTopWidth="1px"
            borderTopColor={borderColor}
            maxH="300px"
            overflowY="auto"
          >
            <VStack align="stretch" spacing={4}>
              {/* Table Info */}
              {tableData && (
                <Box>
                  <Heading size="xs" mb={2} color="gray.600">
                    Table Information
                  </Heading>
                  <SimpleGrid columns={2} spacing={2}>
                    <Text fontSize="xs" color="gray.500">Location:</Text>
                    <Text fontSize="xs" fontFamily="mono" noOfLines={1}>
                      {tableData.location || 'N/A'}
                    </Text>
                    {tableData.lastUpdatedMs && (
                      <>
                        <Text fontSize="xs" color="gray.500">Last Updated:</Text>
                        <Text fontSize="xs">{formatDate(tableData.lastUpdatedMs)}</Text>
                      </>
                    )}
                  </SimpleGrid>
                </Box>
              )}

              <Divider />

              {/* Schema Toggle */}
              <Box>
                <HStack justify="space-between" mb={2}>
                  <Heading size="xs" color="gray.600">Schema</Heading>
                  <IconButton
                    aria-label="Toggle schema"
                    icon={showSchema ? <FiX /> : <FiDatabase />}
                    size="xs"
                    variant="ghost"
                    onClick={() => setShowSchema(!showSchema)}
                  />
                </HStack>
                <Collapse in={showSchema} animateOpacity>
                  {schemaLoading ? (
                    <Spinner size="sm" color="cyan.500" />
                  ) : schemaData ? (
                    <Box borderWidth="1px" borderRadius="md" overflow="hidden" maxH="150px" overflowY="auto">
                      <Table size="sm">
                        <Thead bg={theadBg}>
                          <Tr>
                            <Th fontSize="2xs">Name</Th>
                            <Th fontSize="2xs">Type</Th>
                            <Th fontSize="2xs" w="40px">Req</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {schemaData.fields.map((field) => (
                            <Tr key={field.id}>
                              <Td fontSize="xs" py={1}>{field.name}</Td>
                              <Td py={1}>
                                <Badge colorScheme={getTypeColor(field.type)} fontSize="2xs">
                                  {field.type}
                                </Badge>
                              </Td>
                              <Td py={1}>
                                {field.required && <Icon as={FiCheck} color="green.500" boxSize={3} />}
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  ) : null}
                </Collapse>
              </Box>

              <Divider />

              {/* Snapshots Toggle */}
              <Box>
                <HStack justify="space-between" mb={2}>
                  <Heading size="xs" color="gray.600">Snapshots</Heading>
                  <IconButton
                    aria-label="Toggle snapshots"
                    icon={showSnapshots ? <FiX /> : <FiClock />}
                    size="xs"
                    variant="ghost"
                    onClick={() => setShowSnapshots(!showSnapshots)}
                  />
                </HStack>
                <Collapse in={showSnapshots} animateOpacity>
                  {snapshotsLoading ? (
                    <Spinner size="sm" color="cyan.500" />
                  ) : snapshotsData && snapshotsData.length > 0 ? (
                    <VStack align="stretch" spacing={1} maxH="100px" overflowY="auto">
                      {snapshotsData.map((snapshot, idx) => (
                        <HStack key={snapshot.snapshotId} justify="space-between" fontSize="xs">
                          <Badge colorScheme={idx === 0 ? 'green' : 'gray'} fontSize="2xs">
                            {idx === 0 ? 'Current' : `v${snapshotsData.length - idx}`}
                          </Badge>
                          <Text fontFamily="mono" fontSize="2xs" color="gray.500">
                            {snapshot.snapshotId.toString().slice(0, 8)}...
                          </Text>
                          <Text fontSize="2xs">{formatDate(snapshot.timestampMs)}</Text>
                        </HStack>
                      ))}
                    </VStack>
                  ) : (
                    <Text fontSize="xs" color="gray.500">No snapshots available</Text>
                  )}
                </Collapse>
              </Box>
            </VStack>
          </Box>
        </Collapse>
      </VStack>
    </Card>
  )
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Text,
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Spinner,
  Alert,
  AlertIcon,
  AlertDescription,
  HStack,
  VStack,
  Badge,
  Button,
  IconButton,
  Flex,
  useColorModeValue,
  Icon,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Tabs,
  TabList,
  Tab,
  useToast,
  Card,
} from '@chakra-ui/react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FiPlay,
  FiDownload,
  FiChevronDown,
  FiDatabase,
  FiTable,
  FiMap,
  FiX,
  FiCopy,
  FiSearch,
} from 'react-icons/fi'
import * as api from '../api'
import type { DuckDBTableInfo } from '../types'
import { SQLEditor } from './SQLEditor'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Schema info for autocompletion
interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

interface TableInfoSchema {
  name: string;
  columns: ColumnInfo[];
  schema?: string;
}

interface SchemaInfo {
  name: string;
  tables: TableInfoSchema[];
}

const MotionBox = motion(Box)

// Result type matching PostGIS pattern
interface DuckDBResult {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  has_more: boolean
  total_count?: number
  duration_ms: number
}

interface DuckDBQueryPanelProps {
  connectionId: string
  bucketName: string
  objectKey: string
  displayName: string
  onClose: () => void
}

export default function DuckDBQueryPanel({
  connectionId,
  bucketName,
  objectKey,
  displayName,
  onClose,
}: DuckDBQueryPanelProps) {
  const [tableInfo, setTableInfo] = useState<DuckDBTableInfo | null>(null)
  const [result, setResult] = useState<DuckDBResult | null>(null)
  const [geojsonData, setGeojsonData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [sql, setSql] = useState('')
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [activeView, setActiveView] = useState<'table' | 'map'>('table')
  const limit = 100
  const toast = useToast()

  // Resizable splitter
  const [splitPosition, setSplitPosition] = useState(() => {
    const saved = localStorage.getItem('duckdb-query-split')
    return saved ? parseInt(saved, 10) : 50
  })
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const splitPositionRef = useRef(splitPosition)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  // Colors
  const cardBg = useColorModeValue('white', 'gray.800')
  const headerBg = useColorModeValue('gray.50', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const hoverBg = useColorModeValue('blue.50', 'blue.900')

  // Build schema info for SQLEditor autocompletion
  const schemaInfo: SchemaInfo[] = useMemo(() => {
    if (!tableInfo) return []

    const dataTable: TableInfoSchema = {
      name: 'data',
      columns: tableInfo.columns.map(col => ({
        name: col.name,
        type: col.type,
      })),
    }

    return [{
      name: 'parquet',
      tables: [dataTable],
    }]
  }, [tableInfo])

  // Splitter handlers
  useEffect(() => {
    splitPositionRef.current = splitPosition
  }, [splitPosition])

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newPosition = ((e.clientY - rect.top) / rect.height) * 100
      const clamped = Math.max(20, Math.min(80, newPosition))
      setSplitPosition(clamped)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      localStorage.setItem('duckdb-query-split', splitPositionRef.current.toString())
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Infinite scroll
  useEffect(() => {
    const container = tableContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight - scrollTop - clientHeight < 100 && result?.has_more && !loadingMore) {
        loadMore()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
    // loadMore is declared later in this component (depends on executeQuery
    // below it); adding it here would reference it before initialization.
    // It closes over the same result/loadingMore already listed, so this
    // effect still re-attaches whenever either of those actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, loadingMore])

  // Fetch table info on mount
  useEffect(() => {
    async function fetchTableInfo() {
      if (!connectionId || !bucketName || !objectKey) {
        setError('Missing file information')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const info = await api.getDuckDBTableInfo(connectionId, objectKey)
        setTableInfo(info)
        // Set default SQL
        setSql(info.sampleQueries?.[0] || "SELECT * FROM data LIMIT 100")
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    fetchTableInfo()
  }, [connectionId, bucketName, objectKey])

  // Execute SQL query
  const executeQuery = useCallback(async (appendResults = false) => {
    if (!connectionId || !bucketName || !objectKey || !sql.trim()) {
      return
    }

    const startTime = Date.now()

    if (appendResults) {
      setLoadingMore(true)
    } else {
      setExecuting(true)
      setError(null)
      setResult(null)
      setOffset(0)
    }

    try {
      const currentOffset = appendResults ? offset : 0
      const response = await api.executeDuckDBQuery(connectionId, objectKey, {
        sql,
        limit: limit,
        offset: currentOffset,
      })

      const duration = Date.now() - startTime

      if (response.error) {
        setError(response.error)
        setResult(null)
      } else {
        // Convert to result format with column types
        const columns = response.columns.map((name, i) => ({
          name,
          type: response.columnTypes?.[i] || 'unknown',
        }))

        if (appendResults && result) {
          setResult({
            columns,
            rows: [...result.rows, ...response.rows],
            has_more: response.hasMore,
            total_count: response.totalCount,
            duration_ms: duration,
          })
          setOffset(currentOffset + response.rowCount)
        } else {
          setResult({
            columns,
            rows: response.rows,
            has_more: response.hasMore,
            total_count: response.totalCount,
            duration_ms: duration,
          })
          setOffset(response.rowCount)
        }

        // If spatial, also fetch GeoJSON
        if (response.geometryColumn && !appendResults) {
          try {
            const geojson = await api.executeDuckDBQueryAsGeoJSON(connectionId, objectKey, {
              sql,
              limit: 1000,
            })
            setGeojsonData(geojson)
          } catch {
            // GeoJSON fetch can fail silently
          }
        }
      }
    } catch (err) {
      setError((err as Error).message)
      setResult(null)
    } finally {
      setExecuting(false)
      setLoadingMore(false)
    }
  }, [connectionId, bucketName, objectKey, sql, offset, result])

  const loadMore = useCallback(() => {
    if (result?.has_more && !loadingMore) {
      executeQuery(true)
    }
  }, [result, loadingMore, executeQuery])

  // Initialize map when switching to map view
  useEffect(() => {
    if (activeView !== 'map' || !mapContainerRef.current || !geojsonData) return

    // Clean up existing map
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap Contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [0, 0],
      zoom: 2,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource('query-results', { type: 'geojson', data: geojsonData })

      const features = geojsonData.features
      if (features.length > 0 && features[0].geometry) {
        const geomType = features[0].geometry.type

        if (geomType === 'Point' || geomType === 'MultiPoint') {
          map.addLayer({
            id: 'query-results-layer',
            type: 'circle',
            source: 'query-results',
            paint: {
              'circle-radius': 6,
              'circle-color': '#54A2CC',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          })
        } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
          map.addLayer({
            id: 'query-results-layer',
            type: 'line',
            source: 'query-results',
            paint: { 'line-color': '#54A2CC', 'line-width': 3 },
          })
        } else {
          map.addLayer({
            id: 'query-results-fill',
            type: 'fill',
            source: 'query-results',
            paint: { 'fill-color': '#54A2CC', 'fill-opacity': 0.3 },
          })
          map.addLayer({
            id: 'query-results-layer',
            type: 'line',
            source: 'query-results',
            paint: { 'line-color': '#54A2CC', 'line-width': 2 },
          })
        }

        // Fit bounds
        const bounds = new maplibregl.LngLatBounds()
        features.forEach((feature) => {
          if (feature.geometry) {
            const coords = getCoordinates(feature.geometry)
            coords.forEach((coord) => bounds.extend(coord as [number, number]))
          }
        })
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 50, maxZoom: 15 })
        }
      }

      // Click popup
      map.on('click', 'query-results-layer', (e) => {
        if (e.features?.[0]) {
          const props = e.features[0].properties
          const html = Object.entries(props || {})
            .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
            .join('<br>')
          new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`<div style="max-height:200px;overflow-y:auto;">${html}</div>`)
            .addTo(map)
        }
      })

      map.on('mouseenter', 'query-results-layer', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'query-results-layer', () => { map.getCanvas().style.cursor = '' })
    })

    mapRef.current = map

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [activeView, geojsonData])

  function getCoordinates(geometry: GeoJSON.Geometry): [number, number][] {
    const coords: [number, number][] = []
    const extract = (c: unknown) => {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        coords.push([c[0] as number, c[1] as number])
      } else if (Array.isArray(c)) {
        c.forEach(extract)
      }
    }
    if ('coordinates' in geometry) {
      extract(geometry.coordinates)
    }
    return coords
  }

  const copySQL = () => {
    navigator.clipboard.writeText(sql)
    toast({
      title: 'Copied',
      description: 'SQL copied to clipboard',
      status: 'success',
      duration: 2000,
    })
  }

  const exportResults = (format: 'csv' | 'json') => {
    if (!result) return

    let content = ''
    let filename = ''
    let mimeType = ''

    if (format === 'csv') {
      const headers = result.columns.map(c => c.name).join(',')
      const rows = result.rows.map(row =>
        result.columns.map(col => {
          const cell = row[col.name]
          if (cell === null || cell === undefined) return ''
          const str = String(cell)
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`
          }
          return str
        }).join(',')
      ).join('\n')
      content = `${headers}\n${rows}`
      filename = `${displayName}_query_result.csv`
      mimeType = 'text/csv'
    } else {
      content = JSON.stringify(result.rows, null, 2)
      filename = `${displayName}_query_result.json`
      mimeType = 'application/json'
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // Loading state
  if (loading) {
    return (
      <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
        <Flex h="100%" align="center" justify="center" p={8}>
          <VStack spacing={4}>
            <Spinner size="xl" color="blue.500" thickness="4px" />
            <Text color="gray.500">Loading {displayName}...</Text>
          </VStack>
        </Flex>
      </Card>
    )
  }

  return (
    <Card bg={cardBg} overflow="hidden" h="100%" display="flex" flexDirection="column">
      {/* Header */}
      <Box
        bg="surface.header"
        color="white"
        px={4}
        py={3}
      >
        <HStack justify="space-between">
          <HStack spacing={3}>
            <Icon as={FiDatabase} boxSize={5} />
            <Text fontWeight="600" fontSize="lg">DuckDB Query</Text>
            <Badge colorScheme="blue" borderRadius="sm">{displayName}</Badge>
            {tableInfo && (
              <>
                <Badge colorScheme="green" borderRadius="sm">
                  {tableInfo.rowCount.toLocaleString()} rows
                </Badge>
                <Badge colorScheme="gray" borderRadius="sm">
                  {tableInfo.columns.length} columns
                </Badge>
                {tableInfo.geometryColumn && (
                  <Badge colorScheme="purple" borderRadius="sm">
                    Spatial: {tableInfo.geometryColumn}
                  </Badge>
                )}
              </>
            )}
          </HStack>
          <IconButton
            aria-label="Close"
            icon={<FiX />}
            variant="ghost"
            color="white"
            _hover={{ bg: 'whiteAlpha.200' }}
            onClick={onClose}
          />
        </HStack>
      </Box>

      {/* Content Area with Vertical Resizable Splitter */}
      <Flex ref={containerRef} flex={1} overflow="hidden" position="relative" flexDirection="column">
        {/* Top Panel - SQL Editor */}
        <Box h={`${splitPosition}%`} overflow="hidden" display="flex" flexDirection="column">
          {/* Sample Queries */}
          {tableInfo?.sampleQueries && tableInfo.sampleQueries.length > 0 && (
            <Box px={4} py={2} borderBottom="1px solid" borderColor={borderColor} bg={headerBg}>
              <HStack spacing={2} flexWrap="wrap">
                <Text fontSize="xs" color="gray.500" fontWeight="medium">Samples:</Text>
                {tableInfo.sampleQueries.slice(0, 3).map((query, i) => (
                  <Button
                    key={i}
                    size="xs"
                    variant="outline"
                    onClick={() => setSql(query)}
                    fontFamily="mono"
                    maxW="200px"
                    isTruncated
                  >
                    {query.length > 30 ? query.substring(0, 30) + '...' : query}
                  </Button>
                ))}
              </HStack>
            </Box>
          )}

          {/* SQL Editor */}
          <Box flex={1} overflow="auto" p={4}>
            <VStack spacing={4} align="stretch" h="100%">
              <HStack justify="space-between">
                <Text fontWeight="600" fontSize="sm" color="gray.600">
                  Write your SQL query (use 'data' as table name)
                </Text>
                <HStack>
                  <IconButton
                    aria-label="Copy"
                    icon={<FiCopy />}
                    size="sm"
                    variant="ghost"
                    onClick={copySQL}
                  />
                  <Button
                    colorScheme="blue"
                    size="sm"
                    leftIcon={<FiPlay />}
                    onClick={() => executeQuery(false)}
                    isLoading={executing}
                    loadingText="Running..."
                    isDisabled={!sql.trim()}
                  >
                    Run
                  </Button>
                </HStack>
              </HStack>
              <Box flex={1} minH="100px">
                <SQLEditor
                  value={sql}
                  onChange={setSql}
                  height="100%"
                  placeholder="SELECT * FROM data WHERE ..."
                  dialect="duckdb"
                  schemas={schemaInfo}
                />
              </Box>
            </VStack>
          </Box>
        </Box>

        {/* Resizable Splitter - Horizontal */}
        <Box
          h="4px"
          cursor="row-resize"
          bg={isDragging ? 'blue.400' : borderColor}
          _hover={{ bg: 'blue.400' }}
          transition="background 0.2s"
          onMouseDown={handleSplitterMouseDown}
          flexShrink={0}
        />

        {/* Bottom Panel - Results */}
        <Box
          h={`calc(${100 - splitPosition}% - 4px)`}
          display="flex"
          flexDirection="column"
          overflow="hidden"
        >
          {/* Results Header with View Tabs */}
          <Flex
            px={4}
            py={2}
            bg={headerBg}
            borderBottom="1px solid"
            borderColor={borderColor}
            align="center"
            justify="space-between"
          >
            <HStack>
              <Tabs
                index={activeView === 'table' ? 0 : 1}
                onChange={(i) => setActiveView(i === 0 ? 'table' : 'map')}
                size="sm"
                variant="soft-rounded"
                colorScheme="blue"
              >
                <TabList>
                  <Tab><HStack spacing={1}><Icon as={FiTable} /><Text>Table</Text></HStack></Tab>
                  {geojsonData && (
                    <Tab><HStack spacing={1}><Icon as={FiMap} /><Text>Map</Text></HStack></Tab>
                  )}
                </TabList>
              </Tabs>
              {result && (
                <Badge colorScheme="blue" borderRadius="sm" ml={2}>
                  {result.rows.length}
                  {result.total_count ? ` / ${result.total_count}` : ''} rows
                </Badge>
              )}
              {result && (
                <Badge colorScheme="gray" borderRadius="sm">
                  {result.duration_ms.toFixed(0)}ms
                </Badge>
              )}
            </HStack>
            {result && (
              <Menu>
                <MenuButton
                  as={Button}
                  size="sm"
                  variant="ghost"
                  rightIcon={<FiChevronDown />}
                >
                  <Icon as={FiDownload} />
                </MenuButton>
                <MenuList>
                  <MenuItem icon={<FiDownload />} onClick={() => exportResults('csv')}>
                    Export as CSV
                  </MenuItem>
                  <MenuItem icon={<FiDownload />} onClick={() => exportResults('json')}>
                    Export as JSON
                  </MenuItem>
                </MenuList>
              </Menu>
            )}
          </Flex>

          {/* Error Display */}
          {error && (
            <Alert status="error" borderRadius="none">
              <AlertIcon />
              <AlertDescription fontSize="sm">{error}</AlertDescription>
            </Alert>
          )}

          {/* Results Content */}
          {activeView === 'table' ? (
            <Box
              ref={tableContainerRef}
              flex={1}
              overflow="auto"
              position="relative"
            >
              {executing && !result ? (
                <Flex h="100%" align="center" justify="center">
                  <VStack spacing={4}>
                    <Spinner size="xl" color="blue.500" thickness="4px" />
                    <Text color="gray.500">Executing query...</Text>
                  </VStack>
                </Flex>
              ) : result ? (
                <>
                  <Table size="sm" variant="simple">
                    <Thead position="sticky" top={0} bg={headerBg} zIndex={1}>
                      <Tr>
                        <Th
                          w="50px"
                          textAlign="center"
                          borderBottomWidth="2px"
                          borderBottomColor={borderColor}
                        >
                          #
                        </Th>
                        {result.columns.map((col, i) => (
                          <Th
                            key={i}
                            borderBottomWidth="2px"
                            borderBottomColor={borderColor}
                            whiteSpace="nowrap"
                          >
                            <VStack align="start" spacing={0}>
                              <Text>{col.name}</Text>
                              <Text fontSize="2xs" color="gray.400" fontWeight="normal">
                                {col.type}
                              </Text>
                            </VStack>
                          </Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody>
                      <AnimatePresence>
                        {result.rows.map((row, rowIndex) => (
                          <MotionBox
                            as={Tr}
                            key={rowIndex}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ delay: Math.min(rowIndex * 0.01, 0.5) }}
                            _hover={{ bg: hoverBg }}
                          >
                            <Td
                              textAlign="center"
                              color="gray.400"
                              fontSize="xs"
                              fontFamily="mono"
                            >
                              {rowIndex + 1}
                            </Td>
                            {result.columns.map((col, colIndex) => {
                              const value = row[col.name]
                              const isNull = value === null
                              const displayValue = isNull
                                ? 'NULL'
                                : typeof value === 'object'
                                ? JSON.stringify(value)
                                : String(value)

                              return (
                                <Td
                                  key={colIndex}
                                  maxW="300px"
                                  overflow="hidden"
                                  textOverflow="ellipsis"
                                  whiteSpace="nowrap"
                                  color={isNull ? 'gray.400' : undefined}
                                  fontStyle={isNull ? 'italic' : undefined}
                                  fontSize="sm"
                                  title={displayValue}
                                >
                                  {displayValue.length > 100
                                    ? displayValue.substring(0, 100) + '...'
                                    : displayValue}
                                </Td>
                              )
                            })}
                          </MotionBox>
                        ))}
                      </AnimatePresence>
                    </Tbody>
                  </Table>

                  {/* Loading More Indicator */}
                  {loadingMore && (
                    <Flex py={4} justify="center">
                      <HStack>
                        <Spinner size="sm" />
                        <Text fontSize="sm" color="gray.500">Loading more...</Text>
                      </HStack>
                    </Flex>
                  )}

                  {/* End of Results */}
                  {!result.has_more && result.rows.length > 0 && (
                    <Flex py={4} justify="center">
                      <Text fontSize="sm" color="gray.400">
                        End of results ({result.rows.length} rows)
                      </Text>
                    </Flex>
                  )}
                </>
              ) : (
                <Flex h="100%" align="center" justify="center">
                  <VStack spacing={4} color="gray.400">
                    <Icon as={FiSearch} boxSize={12} />
                    <Text>Execute a query to see results</Text>
                  </VStack>
                </Flex>
              )}
            </Box>
          ) : (
            <Box ref={mapContainerRef} flex={1} />
          )}
        </Box>
      </Flex>
    </Card>
  )
}

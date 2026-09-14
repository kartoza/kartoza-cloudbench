import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardBody,
  Center,
  Heading,
  HStack,
  Icon,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  useColorModeValue,
  VStack,
} from '@chakra-ui/react'
import {
  FiAlertCircle,
  FiCode,
  FiDownload,
  FiEye,
  FiRefreshCw,
  FiTable,
} from 'react-icons/fi'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import { Panel } from "../Panel";
import { PanelHeader } from "../Panel/PanelHeader";
import { PanelBody } from "../Panel/PanelBody";

interface PGTablePanelProps {
  serviceName: string
  schemaName: string
  tableName: string
  isView?: boolean
}

export default function PGTablePanel(
  {
    serviceName,
    schemaName,
    tableName,
    isView = false
  }: PGTablePanelProps) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [totalLoaded, setTotalLoaded] = useState(0)
  const setPGQuery = useUIStore((state) => state.setPGQuery)
  const tableContainerRef = useRef<HTMLDivElement>(null)

  const PAGE_SIZE = 100

  const cardBg = useColorModeValue('white', 'gray.800')
  const tableBg = useColorModeValue('gray.50', 'gray.700')
  const headerBg = useColorModeValue('gray.100', 'gray.600')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  // The API returns rows as array of objects (map[string]any), not array of arrays
  // So we just need to cast them, no transformation needed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processRows = (rawRows: any[]): Record<string, unknown>[] => {
    // If rows are already objects with column names as keys, return them as-is
    if (rawRows.length > 0 && typeof rawRows[0] === 'object' && !Array.isArray(rawRows[0])) {
      return rawRows as Record<string, unknown>[]
    }
    // Fallback: shouldn't happen but handle arrays just in case
    return rawRows as Record<string, unknown>[]
  }

  // Initial load
  useEffect(() => {
    setLoading(true)
    setError(null)
    setRows([])
    setColumns([])
    setTotalLoaded(0)
    setHasMore(true)

    api.getTableData(serviceName, schemaName, tableName, PAGE_SIZE, 0)
      .then(response => {
        if (!response || !response.result) {
          setError('Invalid response from server')
          return
        }
        const { result } = response
        if (result.columns) {
          setColumns(result.columns)
        }
        if (result.rows && result.rows.length > 0) {
          setRows(processRows(result.rows))
          setTotalLoaded(result.rows.length)
          setHasMore(result.rows.length === PAGE_SIZE)
        } else {
          setRows([])
          setHasMore(false)
        }
      })
      .catch(err => setError(err?.message || 'Failed to load data'))
      .finally(() => setLoading(false))
  }, [serviceName, schemaName, tableName])

  // Load more data
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return

    setLoadingMore(true)
    try {
      const response = await api.getTableData(serviceName, schemaName, tableName, PAGE_SIZE, totalLoaded)
      if (!response?.result) {
        setHasMore(false)
        return
      }
      const { result } = response
      if (result.rows && result.rows.length > 0) {
        setRows(prev => [...prev, ...processRows(result.rows)])
        setTotalLoaded(prev => prev + result.rows.length)
        setHasMore(result.rows.length === PAGE_SIZE)
      } else {
        setHasMore(false)
      }
    } catch (err) {
      console.error('Failed to load more rows:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [serviceName, schemaName, tableName, totalLoaded, loadingMore, hasMore])

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    if (!tableContainerRef.current || loadingMore || !hasMore) return

    const { scrollTop, scrollHeight, clientHeight } = tableContainerRef.current
    // Load more when scrolled to 80% of the content
    if (scrollTop + clientHeight >= scrollHeight * 0.8) {
      loadMore()
    }
  }, [loadMore, loadingMore, hasMore])

  // Export to CSV
  const handleExportCSV = () => {
    if (rows.length === 0) return

    const headers = columns.join(',')
    const csvRows = rows.map(row =>
      columns.map(col => {
        const val = row[col]
        if (val === null || val === undefined) return ''
        const str = String(val)
        // Escape quotes and wrap in quotes if contains comma or newline
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }).join(',')
    )
    const csv = [headers, ...csvRows].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${schemaName}_${tableName}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  // Refresh data
  const handleRefresh = () => {
    setLoading(true)
    setError(null)
    setRows([])
    setTotalLoaded(0)
    setHasMore(true)

    api.getTableData(serviceName, schemaName, tableName, PAGE_SIZE, 0)
      .then(response => {
        if (!response?.result) {
          setError('Invalid response from server')
          return
        }
        const { result } = response
        if (result.columns) {
          setColumns(result.columns)
        }
        if (result.rows && result.rows.length > 0) {
          setRows(processRows(result.rows))
          setTotalLoaded(result.rows.length)
          setHasMore(result.rows.length === PAGE_SIZE)
        } else {
          setRows([])
          setHasMore(false)
        }
      })
      .catch(err => setError(err?.message || 'Failed to load data'))
      .finally(() => setLoading(false))
  }

  // Format cell value for display
  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-'
    if (typeof value === 'object') {
      // Handle geometry objects or other complex types
      const str = JSON.stringify(value)
      if (str.length > 100) {
        return str.substring(0, 100) + '...'
      }
      return str
    }
    const str = String(value)
    if (str.length > 100) {
      return str.substring(0, 100) + '...'
    }
    return str
  }

  // Get column name from column (handles both string and object columns)
  const getColumnName = (col: unknown): string => {
    if (typeof col === 'object' && col !== null) {
      // Handle both lowercase (from Go API) and uppercase (from pgx) column names
      const colObj = col as { name?: string; NAME?: string }
      return colObj.name || colObj.NAME || '-'
    }
    return String(col)
  }

  if (loading) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Spinner size="xl" color="blue.500" thickness="4px"/>
          <Text
            color="gray.500">Loading {isView ? 'view' : 'table'} data...</Text>
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
          <Button colorScheme="blue" onClick={handleRefresh}>
            Retry
          </Button>
        </VStack>
      </Center>
    )
  }

  return (
    <Panel>
      {/* Header Card */}
      <PanelHeader>
        <HStack spacing={4}>
          <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
            <Icon as={isView ? FiEye : FiTable} boxSize={6}/>
          </Box>
          <VStack align="start" spacing={0}>
            <Heading size="md" color="white">{tableName}</Heading>
            <HStack spacing={2} opacity={0.9}>
              <Text fontSize="sm">{schemaName}</Text>
              <Text fontSize="sm">|</Text>
              <Text fontSize="sm">{isView ? 'View' : 'Table'}</Text>
              <Text fontSize="sm">|</Text>
              <Text fontSize="sm">{totalLoaded.toLocaleString()} rows
                loaded</Text>
              {hasMore && <Text fontSize="sm">(more available)</Text>}
            </HStack>
          </VStack>
        </HStack>
        <HStack wrap="wrap" gap={2}>
          <Button
            variant="solid"
            bg="whiteAlpha.200"
            color="white"
            size="sm"
            _hover={{ bg: 'whiteAlpha.300' }}
            leftIcon={<FiRefreshCw/>}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          <Button
            variant="solid"
            bg="whiteAlpha.200"
            color="white"
            size="sm"
            _hover={{ bg: 'whiteAlpha.300' }}
            leftIcon={<FiDownload/>}
            onClick={handleExportCSV}
            isDisabled={rows.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="outline"
            color="white"
            borderColor="whiteAlpha.400"
            size="sm"
            _hover={{ bg: 'whiteAlpha.200' }}
            leftIcon={<FiCode/>}
            onClick={() => setPGQuery({
              serviceName,
              schemaName,
              tableName,
              initialSQL: `SELECT *
                           FROM "${schemaName}"."${tableName}" LIMIT 100`,
            })}
          >
            SQL Query
          </Button>
        </HStack>
      </PanelHeader>

      {/* Data Table */}
      <PanelBody>
        <Card
          bg={cardBg} flex="1" overflow="hidden" minH={0} display="flex"
          flexDirection="column">
          <CardBody p={0} flex="1" minH={0} display="flex"
                    flexDirection="column">
            {rows.length === 0 ? (
              <Center h="200px">
                <VStack spacing={2}>
                  <Icon as={FiTable} boxSize={8} color="gray.400"/>
                  <Text color="gray.500">No data in
                    this {isView ? 'view' : 'table'}</Text>
                </VStack>
              </Center>
            ) : (
              <Box
                ref={tableContainerRef}
                flex="1"
                minH={0}
                overflowY="auto"
                overflowX="auto"
                onScroll={handleScroll}
              >
                <Table size="sm" variant="simple">
                  <Thead position="sticky" top={0} bg={headerBg} zIndex={1}>
                    <Tr>
                      <Th
                        borderColor={borderColor}
                        py={3}
                        fontSize="xs"
                        textTransform="none"
                        color="gray.500"
                        w="50px"
                      >
                        #
                      </Th>
                      {columns.map((col, idx) => (
                        <Th
                          key={idx}
                          borderColor={borderColor}
                          py={3}
                          fontSize="xs"
                          whiteSpace="nowrap"
                        >
                          {getColumnName(col)}
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row, rowIdx) => (
                      <Tr
                        key={rowIdx}
                        _hover={{ bg: tableBg }}
                      >
                        <Td
                          borderColor={borderColor}
                          fontSize="xs"
                          color="gray.500"
                          py={2}
                        >
                          {rowIdx + 1}
                        </Td>
                        {columns.map((col, colIdx) => {
                          const colName = getColumnName(col)
                          const cellValue = row[colName]
                          return (
                            <Td
                              key={colIdx}
                              borderColor={borderColor}
                              fontSize="xs"
                              py={2}
                              maxW="300px"
                              overflow="hidden"
                              textOverflow="ellipsis"
                              whiteSpace="nowrap"
                            >
                              <Tooltip
                                label={formatCellValue(cellValue)}
                                placement="top"
                                hasArrow
                                fontSize="xs"
                                openDelay={500}
                              >
                                <Text
                                  as="span"
                                  color={cellValue === null ? 'gray.400' : undefined}
                                  fontStyle={cellValue === null ? 'italic' : undefined}
                                >
                                  {formatCellValue(cellValue)}
                                </Text>
                              </Tooltip>
                            </Td>
                          )
                        })}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>

                {/* Loading more indicator */}
                {loadingMore && (
                  <Center py={4}>
                    <HStack spacing={2}>
                      <Spinner size="sm" color="blue.500"/>
                      <Text fontSize="sm" color="gray.500">Loading more
                        rows...</Text>
                    </HStack>
                  </Center>
                )}

                {/* End of data indicator */}
                {!hasMore && rows.length > 0 && (
                  <Center py={4}>
                    <Text fontSize="sm" color="gray.500">
                      All {totalLoaded.toLocaleString()} rows loaded
                    </Text>
                  </Center>
                )}
              </Box>
            )}
          </CardBody>
        </Card>
      </PanelBody>
    </Panel>
  )
}

import { useState, useEffect, useRef } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  VStack,
  HStack,
  Text,
  Icon,
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
  Alert,
  AlertIcon,
  Textarea,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  IconButton,
  Tooltip,
  useToast,
  Divider,
} from '@chakra-ui/react'
import { FiPlay, FiCode, FiDatabase, FiCopy, FiDownload, FiClock, FiAlertCircle } from 'react-icons/fi'
import { TbSnowflake } from 'react-icons/tb'
import { useUIStore } from '../../stores/uiStore'

interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTime: number
  error?: string
}

export default function IcebergQueryDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const toast = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [query, setQuery] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [queryHistory, setQueryHistory] = useState<string[]>([])

  const isOpen = activeDialog === 'icebergquery'
  const connectionName = dialogData?.data?.connectionName as string | undefined
  const namespace = dialogData?.data?.namespace as string | undefined
  const tableName = dialogData?.data?.tableName as string | undefined

  // Set initial query when dialog opens
  useEffect(() => {
    if (isOpen && namespace && tableName) {
      const initialQuery = `SELECT *
FROM ${namespace}.${tableName}
LIMIT 100`
      setQuery(initialQuery)
      setResult(null)
    } else if (isOpen && namespace) {
      setQuery(`-- Select a table from namespace: ${namespace}\nSELECT * FROM ${namespace}.<table_name> LIMIT 100`)
      setResult(null)
    } else if (isOpen) {
      setQuery('-- Enter your SQL query here\nSELECT * FROM <namespace>.<table> LIMIT 100')
      setResult(null)
    }
  }, [isOpen, namespace, tableName])

  const handleExecute = async () => {
    if (!query.trim()) {
      toast({
        title: 'Empty query',
        description: 'Please enter a SQL query',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsExecuting(true)
    setResult(null)

    try {
      // TODO: Call backend API to execute query via Sedona/Spark
      // For now, show a message that Spark integration is needed
      await new Promise(resolve => setTimeout(resolve, 500))

      setResult({
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime: 0,
        error: 'Query execution requires Apache Sedona/Spark integration. Please ensure the Sedona container is running and connected to this Iceberg catalog.',
      })

      // Add to history
      setQueryHistory(prev => {
        const newHistory = [query, ...prev.filter(q => q !== query)].slice(0, 10)
        return newHistory
      })
    } catch (err) {
      setResult({
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime: 0,
        error: (err as Error).message,
      })
    } finally {
      setIsExecuting(false)
    }
  }

  const handleCopyQuery = () => {
    navigator.clipboard.writeText(query)
    toast({
      title: 'Copied',
      description: 'Query copied to clipboard',
      status: 'success',
      duration: 2000,
    })
  }

  const handleExportCSV = () => {
    if (!result || result.rows.length === 0) return

    const header = result.columns.join(',')
    const rows = result.rows.map(row =>
      result.columns.map(col => {
        const val = row[col]
        if (val === null || val === undefined) return ''
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`
        }
        return String(val)
      }).join(',')
    )
    const csv = [header, ...rows].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query_result_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Format cell value for display
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '∅'
    }
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="6xl" isCentered scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="90vh">
        {/* Gradient Header */}
        <Box
          bg="surface.header"
          p={4}
        >
          <HStack spacing={3} justify="space-between">
            <HStack spacing={3}>
              <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
                <Icon as={TbSnowflake} boxSize={5} color="white" />
              </Box>
              <Box>
                <Text color="white" fontWeight="600" fontSize="lg">
                  Iceberg SQL Query
                </Text>
                <Text color="whiteAlpha.800" fontSize="sm">
                  {connectionName || 'Iceberg Catalog'}
                  {namespace && ` / ${namespace}`}
                  {tableName && ` / ${tableName}`}
                </Text>
              </Box>
            </HStack>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={4} overflowY="auto">
          <VStack spacing={4} align="stretch" h="full">
            {/* Query Editor */}
            <Box>
              <HStack justify="space-between" mb={2}>
                <HStack spacing={2}>
                  <Icon as={FiCode} color="gray.500" />
                  <Text fontWeight="500" color="gray.700">SQL Query</Text>
                </HStack>
                <HStack spacing={1}>
                  <Tooltip label="Copy query">
                    <IconButton
                      aria-label="Copy query"
                      icon={<FiCopy />}
                      size="sm"
                      variant="ghost"
                      onClick={handleCopyQuery}
                    />
                  </Tooltip>
                </HStack>
              </HStack>
              <Textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SELECT * FROM namespace.table LIMIT 100"
                fontFamily="mono"
                fontSize="sm"
                minH="120px"
                borderRadius="lg"
                resize="vertical"
              />
              <HStack mt={2} justify="flex-end">
                <Button
                  colorScheme="cyan"
                  leftIcon={<FiPlay />}
                  onClick={handleExecute}
                  isLoading={isExecuting}
                  loadingText="Executing..."
                  borderRadius="lg"
                >
                  Run Query
                </Button>
              </HStack>
            </Box>

            <Divider />

            {/* Results */}
            <Box flex={1} minH="200px">
              <Tabs variant="soft-rounded" colorScheme="cyan" size="sm">
                <TabList>
                  <Tab><HStack spacing={1}><Icon as={FiDatabase} boxSize={3} /><Text>Results</Text></HStack></Tab>
                  <Tab><HStack spacing={1}><Icon as={FiClock} boxSize={3} /><Text>History</Text></HStack></Tab>
                </TabList>
                <TabPanels>
                  <TabPanel px={0}>
                    {isExecuting && (
                      <VStack py={8}>
                        <Spinner size="lg" color="cyan.500" />
                        <Text color="gray.500">Executing query...</Text>
                      </VStack>
                    )}

                    {!isExecuting && !result && (
                      <Alert status="info" borderRadius="lg">
                        <AlertIcon />
                        <Text fontSize="sm">Run a query to see results</Text>
                      </Alert>
                    )}

                    {result?.error && (
                      <Alert status="error" borderRadius="lg">
                        <AlertIcon as={FiAlertCircle} />
                        <Box>
                          <Text fontWeight="500">Query Error</Text>
                          <Text fontSize="sm">{result.error}</Text>
                        </Box>
                      </Alert>
                    )}

                    {result && !result.error && result.rows.length === 0 && (
                      <Alert status="info" borderRadius="lg">
                        <AlertIcon />
                        <Text fontSize="sm">Query returned no results</Text>
                      </Alert>
                    )}

                    {result && !result.error && result.rows.length > 0 && (
                      <VStack spacing={3} align="stretch">
                        <HStack justify="space-between">
                          <HStack spacing={2}>
                            <Badge colorScheme="cyan">{result.rowCount} rows</Badge>
                            <Badge colorScheme="gray">{result.columns.length} columns</Badge>
                            <Badge colorScheme="green">{result.executionTime}ms</Badge>
                          </HStack>
                          <Tooltip label="Export as CSV">
                            <IconButton
                              aria-label="Export CSV"
                              icon={<FiDownload />}
                              size="sm"
                              variant="outline"
                              onClick={handleExportCSV}
                            />
                          </Tooltip>
                        </HStack>

                        <Box borderWidth="1px" borderRadius="lg" overflow="auto" maxH="300px">
                          <Table size="sm">
                            <Thead bg="gray.50" position="sticky" top={0}>
                              <Tr>
                                {result.columns.map((col) => (
                                  <Th key={col}>{col}</Th>
                                ))}
                              </Tr>
                            </Thead>
                            <Tbody>
                              {result.rows.map((row, idx) => (
                                <Tr key={idx} _hover={{ bg: 'gray.50' }}>
                                  {result.columns.map((col) => (
                                    <Td key={col}>
                                      <Text fontSize="sm" maxW="200px" isTruncated>
                                        {formatValue(row[col])}
                                      </Text>
                                    </Td>
                                  ))}
                                </Tr>
                              ))}
                            </Tbody>
                          </Table>
                        </Box>
                      </VStack>
                    )}
                  </TabPanel>
                  <TabPanel px={0}>
                    {queryHistory.length === 0 ? (
                      <Alert status="info" borderRadius="lg">
                        <AlertIcon />
                        <Text fontSize="sm">No query history yet</Text>
                      </Alert>
                    ) : (
                      <VStack spacing={2} align="stretch">
                        {queryHistory.map((q, idx) => (
                          <Box
                            key={idx}
                            p={2}
                            bg="gray.50"
                            borderRadius="md"
                            cursor="pointer"
                            _hover={{ bg: 'gray.100' }}
                            onClick={() => setQuery(q)}
                          >
                            <Text fontSize="sm" fontFamily="mono" noOfLines={2}>
                              {q}
                            </Text>
                          </Box>
                        ))}
                      </VStack>
                    )}
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          <Button onClick={closeDialog} borderRadius="lg">
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

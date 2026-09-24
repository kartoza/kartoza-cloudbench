import { useState } from 'react'
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
  Select,
  IconButton,
  Tooltip,
} from '@chakra-ui/react'
import { FiDatabase, FiChevronLeft, FiChevronRight, FiRefreshCw } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'

interface TableDataResponse {
  columns: string[]
  rows: Record<string, unknown>[]
  totalRows: number
  offset: number
  limit: number
}

export default function IcebergTableDataDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)

  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(25)

  const isOpen = activeDialog === 'icebergtabledata'
  const connectionId = dialogData?.data?.connectionId as string | undefined
  const namespace = dialogData?.data?.namespace as string | undefined
  const tableName = dialogData?.data?.tableName as string | undefined

  // Fetch table data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['icebergtabledata', connectionId, namespace, tableName, offset, limit],
    queryFn: async (): Promise<TableDataResponse> => {
      // This would call a backend API endpoint for table data
      // For now, return placeholder data showing the table needs Spark/Sedona query
      const schema = await api.getIcebergTableSchema(connectionId!, namespace!, tableName!)
      return {
        columns: schema.fields.map(f => f.name),
        rows: [],
        totalRows: 0,
        offset: 0,
        limit: limit,
      }
    },
    enabled: isOpen && !!connectionId && !!namespace && !!tableName,
  })

  const canGoPrev = offset > 0
  const canGoNext = data && (offset + limit) < data.totalRows

  const handlePrev = () => {
    setOffset(Math.max(0, offset - limit))
  }

  const handleNext = () => {
    if (data) {
      setOffset(offset + limit)
    }
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
      <ModalContent borderRadius="xl" overflow="hidden" maxH="85vh">
        {/* Gradient Header */}
        <Box
          bg="surface.header"
          p={4}
        >
          <HStack spacing={3} justify="space-between">
            <HStack spacing={3}>
              <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
                <Icon as={FiDatabase} boxSize={5} color="white" />
              </Box>
              <Box>
                <Text color="white" fontWeight="600" fontSize="lg">
                  Table Data
                </Text>
                <Text color="whiteAlpha.800" fontSize="sm">
                  {namespace}.{tableName}
                </Text>
              </Box>
            </HStack>
            <HStack spacing={2}>
              <Tooltip label="Refresh data">
                <IconButton
                  aria-label="Refresh"
                  icon={<FiRefreshCw />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={() => refetch()}
                />
              </Tooltip>
            </HStack>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={4} overflowY="auto">
          {isLoading && (
            <VStack py={8}>
              <Spinner size="lg" color="cyan.500" />
              <Text color="gray.500">Loading data...</Text>
            </VStack>
          )}

          {error && (
            <Alert status="error" borderRadius="lg">
              <AlertIcon />
              <Text fontSize="sm">{(error as Error).message}</Text>
            </Alert>
          )}

          {data && data.rows.length === 0 && (
            <Alert status="info" borderRadius="lg">
              <AlertIcon />
              <Box>
                <Text fontWeight="500">No data available</Text>
                <Text fontSize="sm" color="gray.600">
                  Table data querying requires Apache Sedona/Spark integration.
                  Use the Query feature to run SQL queries against this table.
                </Text>
              </Box>
            </Alert>
          )}

          {data && data.rows.length > 0 && (
            <VStack spacing={4} align="stretch">
              <HStack justify="space-between">
                <HStack spacing={2}>
                  <Badge colorScheme="cyan">{data.totalRows} rows</Badge>
                  <Badge colorScheme="gray">{data.columns.length} columns</Badge>
                </HStack>
                <HStack spacing={2}>
                  <Text fontSize="sm" color="gray.500">Rows per page:</Text>
                  <Select
                    size="sm"
                    width="80px"
                    value={limit}
                    onChange={(e) => {
                      setLimit(Number(e.target.value))
                      setOffset(0)
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </Select>
                </HStack>
              </HStack>

              <Box borderWidth="1px" borderRadius="lg" overflow="auto" maxH="50vh">
                <Table size="sm">
                  <Thead bg="gray.50" position="sticky" top={0}>
                    <Tr>
                      {data.columns.map((col) => (
                        <Th key={col}>{col}</Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {data.rows.map((row, idx) => (
                      <Tr key={idx} _hover={{ bg: 'gray.50' }}>
                        {data.columns.map((col) => (
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

              {/* Pagination */}
              <HStack justify="center" spacing={4}>
                <IconButton
                  aria-label="Previous page"
                  icon={<FiChevronLeft />}
                  size="sm"
                  isDisabled={!canGoPrev}
                  onClick={handlePrev}
                />
                <Text fontSize="sm" color="gray.600">
                  Showing {offset + 1} - {Math.min(offset + limit, data.totalRows)} of {data.totalRows}
                </Text>
                <IconButton
                  aria-label="Next page"
                  icon={<FiChevronRight />}
                  size="sm"
                  isDisabled={!canGoNext}
                  onClick={handleNext}
                />
              </HStack>
            </VStack>
          )}
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

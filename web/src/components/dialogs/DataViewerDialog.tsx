import { useState, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
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
  AlertTitle,
  AlertDescription,
  HStack,
  Badge,
  Button,
  IconButton,
  Flex,
  useColorModeValue,
  Tooltip,
  Input,
  Select,
} from '@chakra-ui/react'
import { FiChevronLeft, FiChevronRight, FiRefreshCw, FiDownload } from 'react-icons/fi'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api/client'

export default function DataViewerDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)

  const isOpen = activeDialog === 'dataviewer'

  if (!isOpen) {
    return null
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="6xl" scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent maxH="85vh" borderRadius="xl" overflow="hidden">
        <DataViewerContent dialogData={dialogData} onClose={closeDialog} />
      </ModalContent>
    </Modal>
  )
}

interface DataViewerContentProps {
  dialogData: {
    data?: {
      serviceName?: string
      schemaName?: string
      tableName?: string
      isView?: boolean
    }
  } | null
  onClose: () => void
}

function DataViewerContent({ dialogData, onClose }: DataViewerContentProps) {
  const [data, setData] = useState<api.ExecuteQueryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [totalRows, setTotalRows] = useState<number | null>(null)

  const tableBg = useColorModeValue('white', 'gray.800')
  const headerBg = useColorModeValue('gray.50', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const hoverBg = useColorModeValue('gray.50', 'gray.700')

  const serviceName = dialogData?.data?.serviceName ?? ''
  const schemaName = dialogData?.data?.schemaName ?? ''
  const tableName = dialogData?.data?.tableName ?? ''
  const isView = dialogData?.data?.isView ?? false

  const fetchData = async () => {
    if (!serviceName || !schemaName || !tableName) {
      setError('Missing table information')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await api.getTableData(
        serviceName,
        schemaName,
        tableName,
        pageSize,
        page * pageSize
      )
      setData(result)

      // Get total count on first load
      if (totalRows === null) {
        try {
          const countResult = await api.executeQuery(
            serviceName,
            `SELECT COUNT(*) as count FROM "${schemaName}"."${tableName}"`,
            1
          )
          if (countResult.result.rows.length > 0) {
            setTotalRows(Number(countResult.result.rows[0][0]))
          }
        } catch {
          // Ignore count errors
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [serviceName, schemaName, tableName, page, pageSize])

  const handleRefresh = () => {
    setTotalRows(null)
    fetchData()
  }

  const handleExportCSV = () => {
    if (!data?.result) return

    const headers = data.result.columns.join(',')
    const rows = data.result.rows.map((row) =>
      row.map((cell) => {
        if (cell === null) return ''
        const str = String(cell)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }).join(',')
    )
    const csv = [headers, ...rows].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${schemaName}.${tableName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = totalRows !== null ? Math.ceil(totalRows / pageSize) : null
  const currentRange = {
    start: page * pageSize + 1,
    end: Math.min((page + 1) * pageSize, totalRows ?? (page + 1) * pageSize),
  }

  return (
    <>
      {/* Gradient Header */}
      <Box
        bg="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
        px={6}
        py={4}
      >
        <Flex justify="space-between" align="center">
          <Box>
            <HStack spacing={2} mb={1}>
              <Badge bg="whiteAlpha.200" color="white" fontSize="xs">
                {isView ? 'VIEW' : 'TABLE'}
              </Badge>
              <Text color="white" fontWeight="600" fontSize="lg">
                {tableName}
              </Text>
            </HStack>
            <HStack spacing={2}>
              <Text color="whiteAlpha.800" fontSize="sm">
                {serviceName}
              </Text>
              <Text color="whiteAlpha.600" fontSize="sm">
                /
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {schemaName}
              </Text>
            </HStack>
          </Box>
          <HStack spacing={2}>
            <Tooltip label="Refresh">
              <IconButton
                aria-label="Refresh"
                icon={<FiRefreshCw />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleRefresh}
                isLoading={loading}
              />
            </Tooltip>
            <Tooltip label="Export CSV">
              <IconButton
                aria-label="Export CSV"
                icon={<FiDownload />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleExportCSV}
                isDisabled={!data?.result}
              />
            </Tooltip>
          </HStack>
        </Flex>
      </Box>
      <ModalCloseButton color="white" />

      <ModalBody p={0}>
        {loading && !data && (
          <Flex justify="center" align="center" py={12}>
            <Spinner size="xl" color="purple.500" thickness="3px" />
          </Flex>
        )}

        {error && (
          <Alert status="error" m={4} borderRadius="md">
            <AlertIcon />
            <Box>
              <AlertTitle>Query Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Box>
          </Alert>
        )}

        {data?.result && (
          <Box overflowX="auto" maxH="60vh">
            <Table size="sm" variant="simple" bg={tableBg}>
              <Thead position="sticky" top={0} bg={headerBg} zIndex={1}>
                <Tr>
                  <Th
                    borderColor={borderColor}
                    fontSize="xs"
                    color="gray.500"
                    w="50px"
                    textAlign="center"
                  >
                    #
                  </Th>
                  {data.result.columns.map((col, idx) => (
                    <Th
                      key={idx}
                      borderColor={borderColor}
                      fontSize="xs"
                      textTransform="none"
                      letterSpacing="normal"
                      fontWeight="600"
                      color="gray.700"
                      _dark={{ color: 'gray.200' }}
                    >
                      {col}
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.result.rows.map((row, rowIdx) => (
                  <Tr
                    key={rowIdx}
                    _hover={{ bg: hoverBg }}
                    transition="background 0.1s"
                  >
                    <Td
                      borderColor={borderColor}
                      fontSize="xs"
                      color="gray.400"
                      textAlign="center"
                      fontFamily="mono"
                    >
                      {page * pageSize + rowIdx + 1}
                    </Td>
                    {row.map((cell, cellIdx) => (
                      <Td
                        key={cellIdx}
                        borderColor={borderColor}
                        fontSize="sm"
                        maxW="300px"
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                        title={cell !== null ? String(cell) : ''}
                      >
                        {cell === null ? (
                          <Text color="gray.400" fontStyle="italic" fontSize="xs">
                            NULL
                          </Text>
                        ) : typeof cell === 'object' ? (
                          <Text color="blue.500" fontSize="xs" fontFamily="mono">
                            {JSON.stringify(cell)}
                          </Text>
                        ) : (
                          String(cell)
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        )}

        {data?.result && data.result.rows.length === 0 && (
          <Flex justify="center" align="center" py={12}>
            <Text color="gray.500">No data found in this table</Text>
          </Flex>
        )}
      </ModalBody>

      <ModalFooter
        borderTop="1px solid"
        borderTopColor={borderColor}
        bg={headerBg}
        justifyContent="space-between"
      >
        <HStack spacing={4}>
          <HStack spacing={2}>
            <Text fontSize="sm" color="gray.600">
              Rows per page:
            </Text>
            <Select
              size="sm"
              w="80px"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </Select>
          </HStack>
          {totalRows !== null && (
            <Text fontSize="sm" color="gray.600">
              {currentRange.start}-{currentRange.end} of {totalRows.toLocaleString()} rows
            </Text>
          )}
          {data?.result && (
            <Badge colorScheme="green" fontSize="xs">
              {data.result.execution_time_ms}ms
            </Badge>
          )}
        </HStack>

        <HStack spacing={2}>
          <IconButton
            aria-label="Previous page"
            icon={<FiChevronLeft />}
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            isDisabled={page === 0 || loading}
          />
          <Input
            size="sm"
            w="60px"
            textAlign="center"
            value={page + 1}
            onChange={(e) => {
              const newPage = parseInt(e.target.value, 10) - 1
              if (!isNaN(newPage) && newPage >= 0) {
                if (totalPages === null || newPage < totalPages) {
                  setPage(newPage)
                }
              }
            }}
          />
          {totalPages !== null && (
            <Text fontSize="sm" color="gray.500">
              of {totalPages}
            </Text>
          )}
          <IconButton
            aria-label="Next page"
            icon={<FiChevronRight />}
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
            isDisabled={
              loading ||
              (totalPages !== null && page >= totalPages - 1) ||
              (data?.result && data.result.rows.length < pageSize)
            }
          />
          <Button variant="ghost" onClick={onClose} ml={4}>
            Close
          </Button>
        </HStack>
      </ModalFooter>
    </>
  )
}

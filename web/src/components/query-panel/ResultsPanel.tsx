// Query Results Display Component

import {
  Box,
  Flex,
  VStack,
  HStack,
  Text,
  Button,
  Icon,
  Badge,
  useColorModeValue,
  Spinner,
  Alert,
  AlertIcon,
  AlertDescription,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  FiTable,
  FiDownload,
  FiChevronDown,
  FiSearch,
} from 'react-icons/fi'
import type { QueryResult } from './types'

const MotionBox = motion(Box)

interface ResultsPanelProps {
  result: QueryResult | null
  error: string
  executing: boolean
  loadingMore: boolean
  tableContainerRef: React.RefObject<HTMLDivElement>
  onExport: (format: 'csv' | 'json') => void
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  result,
  error,
  executing,
  loadingMore,
  tableContainerRef,
  onExport,
}) => {
  const headerBg = useColorModeValue('gray.50', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const hoverBg = useColorModeValue('blue.50', 'blue.900')

  return (
    <>
      {/* Results Header */}
      <Flex
        px={4}
        py={3}
        bg={headerBg}
        borderBottom="1px solid"
        borderColor={borderColor}
        align="center"
        justify="space-between"
      >
        <HStack>
          <Icon as={FiTable} color="blue.500" />
          <Text fontWeight="600">Results</Text>
          {result && (
            <Badge colorScheme="blue" borderRadius="full">
              {result.rows.length}
              {result.total_count ? ` / ${result.total_count}` : ''} rows
            </Badge>
          )}
          {result && (
            <Badge colorScheme="gray" borderRadius="full">
              {(result.duration_ms ?? 0).toFixed(2)}ms
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
              <MenuItem icon={<FiDownload />} onClick={() => onExport('csv')}>
                Export as CSV
              </MenuItem>
              <MenuItem icon={<FiDownload />} onClick={() => onExport('json')}>
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

      {/* Results Table with Infinite Scroll */}
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
                      transition={{ delay: rowIndex * 0.01 }}
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
    </>
  )
}

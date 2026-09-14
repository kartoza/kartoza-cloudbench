import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalBody,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  VStack,
  HStack,
  Box,
  Text,
  Tag,
  TagLabel,
  Spinner,
  Kbd,
  useColorModeValue,
  Icon,
  Flex,
  Badge,
} from '@chakra-ui/react'
import { FiSearch, FiX, FiFolder, FiDatabase, FiImage, FiLayers, FiEdit3, FiBook, FiEye, FiColumns, FiCode, FiTable, FiCloud, FiHardDrive, FiFile, FiMap, FiServer } from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import { TbWorld } from 'react-icons/tb'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api'
import { useTreeStore } from '../stores/treeStore'
import type { NodeType } from '../types'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect?: (result: api.SearchResult) => void
}

const typeIcons: Record<string, React.ElementType> = {
  workspace: FiFolder,
  datastore: FiDatabase,
  coveragestore: FiImage,
  layer: FiLayers,
  style: FiEdit3,
  layergroup: FiBook,
  // PostgreSQL types
  pgservice: SiPostgresql,
  pgschema: FiFolder,
  pgtable: FiTable,
  pgview: FiEye,
  pgcolumn: FiColumns,
  pgfunction: FiCode,
  // S3 types
  s3connection: FiCloud,
  s3bucket: FiHardDrive,
  s3object: FiFile,
  // QGIS types
  qgisproject: FiMap,
  // GeoNode types
  geonodeconnection: TbWorld,
  geonodedataset: FiLayers,
  geonodemap: FiMap,
  geonodedocument: FiFile,
  // Mergin Maps types
  merginmapsconnection: FiServer,
  merginmapsproject: FiFolder,
}

const typeColors: Record<string, string> = {
  workspace: 'blue',
  datastore: 'green',
  coveragestore: 'orange',
  layer: 'teal',
  style: 'purple',
  layergroup: 'cyan',
  // PostgreSQL types
  pgservice: 'blue',
  pgschema: 'cyan',
  pgtable: 'green',
  pgview: 'purple',
  pgcolumn: 'gray',
  pgfunction: 'orange',
  // S3 types
  s3connection: 'orange',
  s3bucket: 'yellow',
  s3object: 'gray',
  // QGIS types
  qgisproject: 'green',
  // GeoNode types
  geonodeconnection: 'teal',
  geonodedataset: 'teal',
  geonodemap: 'teal',
  geonodedocument: 'teal',
  // Mergin Maps types
  merginmapsconnection: 'green',
  merginmapsproject: 'green',
}

export function SearchModal({ isOpen, onClose, onSelect }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const selectNode = useTreeStore((state) => state.selectNode)
  const expandNode = useTreeStore((state) => state.expandNode)

  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const hoverBg = useColorModeValue('gray.50', 'gray.700')
  const selectedBg = useColorModeValue('kartoza.50', 'kartoza.900')
  const mutedColor = useColorModeValue('gray.500', 'gray.400')

  // Fetch suggestions
  const { data: suggestionsData } = useQuery({
    queryKey: ['searchSuggestions'],
    queryFn: api.getSearchSuggestions,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Search query with debounce
  const { data: searchData, isLoading } = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: query.length >= 2,
    staleTime: 30 * 1000, // 30 seconds
  })

  const results = useMemo(() => searchData?.results || [], [searchData])
  const suggestions = suggestionsData?.suggestions || []

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [results])

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
    if (!isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && results.length > 0) {
      const selectedElement = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex, results.length])

  const handleSelect = useCallback((result: api.SearchResult) => {
    // Check if this is a PostgreSQL result
    const isPGResult = ['pgservice', 'pgschema', 'pgtable', 'pgview', 'pgcolumn', 'pgfunction'].includes(result.type)
    // Check if this is an S3 result
    const isS3Result = ['s3connection', 's3bucket', 's3object'].includes(result.type)
    // Check if this is a QGIS result
    const isQGISResult = ['qgisproject'].includes(result.type)
    // Check if this is a GeoNode result
    const isGeoNodeResult = ['geonodeconnection', 'geonodedataset', 'geonodemap', 'geonodedocument', 'geonodegeostory', 'geonodedashboard'].includes(result.type)

    if (isPGResult) {
      // Expand PostgreSQL root node
      expandNode('postgresql')

      // Expand service node if we have a service name
      if (result.serviceName) {
        expandNode(`pgservice:${result.serviceName}`)

        // Expand schema node if we have a schema name
        if (result.schemaName) {
          expandNode(`pgschema:${result.serviceName}:${result.schemaName}`)

          // Expand table node for column results
          if (result.type === 'pgcolumn' && result.tableName) {
            expandNode(`pgtable:${result.serviceName}:${result.schemaName}:${result.tableName}`)
          }
        }
      }

      // Build the correct node ID based on type
      let nodeId: string
      if (result.type === 'pgservice') {
        nodeId = `pgservice:${result.serviceName}`
      } else if (result.type === 'pgschema') {
        nodeId = `pgschema:${result.serviceName}:${result.schemaName}`
      } else if (result.type === 'pgtable' || result.type === 'pgview') {
        nodeId = `${result.type}:${result.serviceName}:${result.schemaName}:${result.name}`
      } else if (result.type === 'pgcolumn') {
        nodeId = `pgcolumn:${result.serviceName}:${result.schemaName}:${result.tableName}:${result.name}`
      } else if (result.type === 'pgfunction') {
        nodeId = `pgfunction:${result.serviceName}:${result.schemaName}:${result.name}`
      } else {
        nodeId = `${result.type}:${result.serviceName}:${result.name}`
      }

      // Navigate to the selected item in the tree
      selectNode({
        id: nodeId,
        name: result.name,
        type: result.type as NodeType,
        serviceName: result.serviceName,
        schemaName: result.schemaName,
        // For tables/views, the tableName is the result name itself
        tableName: (result.type === 'pgtable' || result.type === 'pgview') ? result.name : result.tableName,
      })
    } else if (isS3Result) {
      // S3 result handling
      expandNode('s3storage-root')

      if (result.s3ConnectionId) {
        expandNode(`s3conn-${result.s3ConnectionId}`)

        if (result.s3Bucket) {
          expandNode(`s3bucket-${result.s3ConnectionId}-${result.s3Bucket}`)
        }
      }

      // Navigate to the selected item
      let nodeId: string
      if (result.type === 's3connection') {
        nodeId = `s3conn-${result.s3ConnectionId}`
      } else if (result.type === 's3bucket') {
        nodeId = `s3bucket-${result.s3ConnectionId}-${result.s3Bucket}`
      } else {
        nodeId = `s3object-${result.s3ConnectionId}-${result.s3Bucket}-${result.s3Key}`
      }

      selectNode({
        id: nodeId,
        name: result.name,
        type: result.type as NodeType,
        s3ConnectionId: result.s3ConnectionId,
        s3Bucket: result.s3Bucket,
        s3Key: result.s3Key,
      })
    } else if (isQGISResult) {
      // QGIS result handling
      expandNode('qgis-projects-root')

      selectNode({
        id: `qgis-project-${result.qgisProjectId}`,
        name: result.name,
        type: 'qgisproject' as NodeType,
        qgisProjectId: result.qgisProjectId,
        qgisProjectPath: result.qgisProjectPath,
      })
    } else if (isGeoNodeResult) {
      // GeoNode result handling
      expandNode('geonode-root')

      if (result.geonodeConnectionId) {
        expandNode(`geonodeconn-${result.geonodeConnectionId}`)

        // Expand the appropriate category
        if (result.type === 'geonodedataset') {
          expandNode(`geonode-datasets-${result.geonodeConnectionId}`)
        } else if (result.type === 'geonodemap') {
          expandNode(`geonode-maps-${result.geonodeConnectionId}`)
        } else if (result.type === 'geonodedocument') {
          expandNode(`geonode-documents-${result.geonodeConnectionId}`)
        }
      }

      // Navigate to the selected item
      let nodeId: string
      if (result.type === 'geonodeconnection') {
        nodeId = `geonodeconn-${result.geonodeConnectionId}`
      } else {
        // For individual resources, use the category-resource-pk format
        const category = result.type.replace('geonode', '') + 's' // e.g., 'datasets', 'maps'
        nodeId = `geonode-${category}-resource-${result.geonodeResourcePk}`
      }

      selectNode({
        id: nodeId,
        name: result.name,
        type: result.type as NodeType,
        geonodeConnectionId: result.geonodeConnectionId,
        geonodeResourcePk: result.geonodeResourcePk,
        geonodeAlternate: result.geonodeAlternate,
        geonodeUrl: result.geonodeUrl,
      })
    } else {
      // GeoServer result handling
      // Expand connection node
      expandNode(`connection:${result.connectionId}`)

      // Expand workspace if applicable
      if (result.workspace) {
        expandNode(`workspace:${result.connectionId}:${result.workspace}`)

        // Expand the appropriate category folder
        if (result.type === 'layer') {
          expandNode(`layers:${result.connectionId}:${result.workspace}`)
        } else if (result.type === 'style') {
          expandNode(`styles:${result.connectionId}:${result.workspace}`)
        } else if (result.type === 'datastore') {
          expandNode(`datastores:${result.connectionId}:${result.workspace}`)
        } else if (result.type === 'coveragestore') {
          expandNode(`coveragestores:${result.connectionId}:${result.workspace}`)
        } else if (result.type === 'layergroup') {
          expandNode(`layergroups:${result.connectionId}:${result.workspace}`)
        }
      }

      // Navigate to the selected item in the tree
      selectNode({
        id: `${result.type}:${result.connectionId}:${result.workspace || ''}:${result.name}`,
        name: result.name,
        type: result.type as NodeType,
        connectionId: result.connectionId,
        workspace: result.workspace,
      })
    }

    if (onSelect) {
      onSelect(result)
    }
    onClose()
  }, [onSelect, onClose, selectNode, expandNode])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      handleSelect(results[selectedIndex])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [results, selectedIndex, handleSelect, onClose])

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion)
    inputRef.current?.focus()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" motionPreset="slideInBottom">
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent
        bg={bgColor}
        borderRadius="xl"
        overflow="hidden"
        mx={4}
        my={20}
        maxH="70vh"
      >
        <ModalBody p={0}>
          {/* Search Input */}
          <Box p={4} borderBottomWidth="1px" borderColor={borderColor}>
            <InputGroup size="lg">
              <InputLeftElement pointerEvents="none">
                {isLoading ? (
                  <Spinner size="sm" color="kartoza.500" />
                ) : (
                  <Icon as={FiSearch} color={mutedColor} />
                )}
              </InputLeftElement>
              <Input
                ref={inputRef}
                placeholder="Search layers, datasets, S3, QGIS, GeoNode..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                border="none"
                _focus={{ boxShadow: 'none' }}
                fontSize="md"
              />
              {query && (
                <InputRightElement>
                  <Icon
                    as={FiX}
                    color={mutedColor}
                    cursor="pointer"
                    onClick={() => setQuery('')}
                    _hover={{ color: 'kartoza.500' }}
                  />
                </InputRightElement>
              )}
            </InputGroup>

            {/* Suggestions */}
            {!query && suggestions.length > 0 && (
              <HStack mt={3} spacing={2} flexWrap="wrap">
                <Text fontSize="sm" color={mutedColor}>
                  Try searching for:
                </Text>
                {suggestions.slice(0, 6).map((suggestion) => (
                  <Tag
                    key={suggestion}
                    size="sm"
                    variant="subtle"
                    colorScheme="gray"
                    cursor="pointer"
                    onClick={() => handleSuggestionClick(suggestion)}
                    _hover={{ bg: 'gray.200' }}
                    borderRadius="full"
                  >
                    <TagLabel>{suggestion}</TagLabel>
                  </Tag>
                ))}
              </HStack>
            )}
          </Box>

          {/* Results */}
          <Box
            ref={resultsRef}
            maxH="50vh"
            overflowY="auto"
            py={2}
          >
            {query.length >= 2 && results.length === 0 && !isLoading && (
              <Box p={8} textAlign="center">
                <Text color={mutedColor}>No results found for "{query}"</Text>
              </Box>
            )}

            {query.length >= 2 && query.length < 2 && (
              <Box p={8} textAlign="center">
                <Text color={mutedColor}>Type at least 2 characters to search</Text>
              </Box>
            )}

            {results.map((result, index) => (
              <SearchResultCard
                key={`${result.connectionId}-${result.type}-${result.name}-${index}`}
                result={result}
                isSelected={index === selectedIndex}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setSelectedIndex(index)}
                dataIndex={index}
                hoverBg={hoverBg}
                selectedBg={selectedBg}
              />
            ))}

            {!query && (
              <Box p={8} textAlign="center">
                <VStack spacing={3}>
                  <Icon as={FiSearch} boxSize={8} color={mutedColor} />
                  <Text color={mutedColor}>
                    Search across GeoServer, PostgreSQL, S3, QGIS, and GeoNode resources
                  </Text>
                  <HStack spacing={1} fontSize="sm" color={mutedColor}>
                    <Text>Press</Text>
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                    <Text>to navigate,</Text>
                    <Kbd>Enter</Kbd>
                    <Text>to select</Text>
                  </HStack>
                </VStack>
              </Box>
            )}
          </Box>

          {/* Footer */}
          <Box
            px={4}
            py={2}
            borderTopWidth="1px"
            borderColor={borderColor}
            bg={useColorModeValue('gray.50', 'gray.900')}
          >
            <HStack justify="space-between" fontSize="xs" color={mutedColor}>
              <HStack spacing={4}>
                <HStack spacing={1}>
                  <Kbd size="xs">↑↓</Kbd>
                  <Text>Navigate</Text>
                </HStack>
                <HStack spacing={1}>
                  <Kbd size="xs">Enter</Kbd>
                  <Text>Select</Text>
                </HStack>
                <HStack spacing={1}>
                  <Kbd size="xs">Esc</Kbd>
                  <Text>Close</Text>
                </HStack>
              </HStack>
              {searchData && (
                <Text>{searchData.total} results</Text>
              )}
            </HStack>
          </Box>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

interface SearchResultCardProps {
  result: api.SearchResult
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  dataIndex: number
  hoverBg: string
  selectedBg: string
}

function SearchResultCard({
  result,
  isSelected,
  onClick,
  onMouseEnter,
  dataIndex,
  hoverBg,
  selectedBg,
}: SearchResultCardProps) {
  const TypeIcon = typeIcons[result.type] || FiFolder
  const typeColor = typeColors[result.type] || 'gray'
  const mutedColor = useColorModeValue('gray.500', 'gray.400')

  return (
    <Box
      data-index={dataIndex}
      px={4}
      py={3}
      cursor="pointer"
      bg={isSelected ? selectedBg : 'transparent'}
      _hover={{ bg: isSelected ? selectedBg : hoverBg }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      transition="background 0.1s"
    >
      <Flex align="start" gap={3}>
        {/* Icon */}
        <Box
          p={2}
          bg={`${typeColor}.100`}
          borderRadius="lg"
          color={`${typeColor}.600`}
        >
          <Icon as={TypeIcon} boxSize={5} />
        </Box>

        {/* Content */}
        <Box flex={1} minW={0}>
          <HStack spacing={2} mb={1}>
            <Text fontWeight="semibold" fontSize="sm" noOfLines={1}>
              {result.name}
            </Text>
            {result.tags.map((tag) => (
              <Badge
                key={tag}
                colorScheme={typeColor}
                fontSize="xs"
                borderRadius="full"
                px={2}
              >
                {tag}
              </Badge>
            ))}
          </HStack>

          <HStack spacing={2} fontSize="xs" color={mutedColor}>
            <Text>{result.serverName}</Text>
            {result.workspace && (
              <>
                <Text>•</Text>
                <Text>{result.workspace}</Text>
              </>
            )}
          </HStack>
        </Box>

        {/* Selection indicator */}
        {isSelected && (
          <Kbd size="xs" alignSelf="center">Enter</Kbd>
        )}
      </Flex>
    </Box>
  )
}

// Hook for global Ctrl+K shortcut
export function useSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        onOpen()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpen])
}

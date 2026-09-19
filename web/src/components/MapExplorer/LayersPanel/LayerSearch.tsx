import { useMemo, useState } from 'react'
import { Badge, Box, HStack, Input, InputGroup, InputLeftElement, List, ListItem, Text } from '@chakra-ui/react'
import { FiSearch } from 'react-icons/fi'

import type { LayerSearchOption } from '../types'

const MAX_SUGGESTIONS = 20

interface LayerSearchProps {
  options: LayerSearchOption[]
  onSelect: (option: LayerSearchOption) => void
  isDisabled?: boolean
}

export default function LayerSearch({ options, onSelect, isDisabled }: LayerSearchProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.key.toLowerCase().includes(q) ||
            o.bucketName.toLowerCase().includes(q) ||
            o.connectionName.toLowerCase().includes(q)
        )
      : options
    return matches.slice(0, MAX_SUGGESTIONS)
  }, [options, query])

  const handleSelect = (option: LayerSearchOption) => {
    onSelect(option)
    setQuery('')
    setIsOpen(false)
  }

  return (
    <Box position="relative" mb={3}>
      <InputGroup size="sm">
        <InputLeftElement pointerEvents="none">
          <FiSearch color="var(--chakra-colors-gray-400)" size={14} />
        </InputLeftElement>
        <Input
          placeholder={options.length === 0 ? 'No layers found across your S3 connections' : 'Search layers to add…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          isDisabled={isDisabled || options.length === 0}
          rounded="md"
        />
      </InputGroup>

      {isOpen && suggestions.length > 0 && (
        <List
          position="absolute"
          top="calc(100% + 4px)"
          left={0}
          right={0}
          bg="white"
          border="1px solid"
          borderColor="gray.100"
          rounded="md"
          shadow="lg"
          maxH="220px"
          overflowY="auto"
          zIndex={10}
        >
          {suggestions.map((option) => (
            <ListItem
              key={`${option.connectionId}-${option.bucketName}-${option.key}`}
              px={3}
              py={2}
              cursor="pointer"
              _hover={{ bg: 'gray.50' }}
              // Fire before the input's onBlur closes the list.
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(option)
              }}
            >
              <HStack justify="space-between" spacing={2}>
                <Box minW={0}>
                  <Text fontSize="sm" color="gray.700" noOfLines={1}>
                    {option.name}
                  </Text>
                  <Text fontSize="xs" color="gray.400" noOfLines={1}>
                    {option.connectionName} / {option.bucketName}
                  </Text>
                </Box>
                <Badge
                  flexShrink={0}
                  fontSize="9px"
                  colorScheme={option.format === 'cog' ? 'purple' : 'blue'}
                >
                  {option.format.toUpperCase()}
                </Badge>
              </HStack>
            </ListItem>
          ))}
        </List>
      )}

      {isOpen && query && suggestions.length === 0 && (
        <Box
          position="absolute"
          top="calc(100% + 4px)"
          left={0}
          right={0}
          bg="white"
          border="1px solid"
          borderColor="gray.100"
          rounded="md"
          shadow="lg"
          p={3}
          zIndex={10}
        >
          <Text fontSize="sm" color="gray.400">
            No matching layers
          </Text>
        </Box>
      )}
    </Box>
  )
}

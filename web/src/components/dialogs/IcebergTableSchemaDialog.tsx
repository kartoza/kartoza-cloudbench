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
} from '@chakra-ui/react'
import { FiBox, FiCheck, FiX } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'

export default function IcebergTableSchemaDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)

  const isOpen = activeDialog === 'icebergtablepreview'
  const connectionId = dialogData?.data?.connectionId as string | undefined
  const namespace = dialogData?.data?.namespace as string | undefined
  const tableName = dialogData?.data?.tableName as string | undefined

  // Fetch schema
  const { data: schema, isLoading, error } = useQuery({
    queryKey: ['icebergtableschema', connectionId, namespace, tableName],
    queryFn: () => api.getIcebergTableSchema(connectionId!, namespace!, tableName!),
    enabled: isOpen && !!connectionId && !!namespace && !!tableName,
  })

  // Get type color
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
    if (lowerType.includes('binary') || lowerType.includes('bytes')) {
      return 'gray'
    }
    if (lowerType.includes('geometry') || lowerType.includes('point') || lowerType.includes('polygon') || lowerType.includes('linestring')) {
      return 'cyan'
    }
    return 'gray'
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="xl" isCentered scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="80vh">
        {/* Gradient Header */}
        <Box
          bg="surface.header"
          p={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiBox} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Table Schema
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {namespace}.{tableName}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={4} overflowY="auto">
          {isLoading && (
            <VStack py={8}>
              <Spinner size="lg" color="cyan.500" />
              <Text color="gray.500">Loading schema...</Text>
            </VStack>
          )}

          {error && (
            <Alert status="error" borderRadius="lg">
              <AlertIcon />
              <Text fontSize="sm">{(error as Error).message}</Text>
            </Alert>
          )}

          {schema && (
            <VStack spacing={4} align="stretch">
              <HStack>
                <Badge colorScheme="cyan">Schema ID: {schema.schemaId}</Badge>
                <Badge colorScheme="gray">{schema.fields.length} fields</Badge>
              </HStack>

              <Box borderWidth="1px" borderRadius="lg" overflow="hidden">
                <Table size="sm">
                  <Thead bg="gray.50">
                    <Tr>
                      <Th width="60px">#</Th>
                      <Th>Name</Th>
                      <Th>Type</Th>
                      <Th width="80px">Required</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {schema.fields.map((field) => (
                      <Tr key={field.id} _hover={{ bg: 'gray.50' }}>
                        <Td>
                          <Text color="gray.500" fontSize="xs">{field.id}</Text>
                        </Td>
                        <Td>
                          <VStack align="start" spacing={0}>
                            <Text fontWeight="500">{field.name}</Text>
                            {field.doc && (
                              <Text fontSize="xs" color="gray.500">{field.doc}</Text>
                            )}
                          </VStack>
                        </Td>
                        <Td>
                          <Badge colorScheme={getTypeColor(field.type)} fontFamily="mono" fontSize="xs">
                            {field.type}
                          </Badge>
                        </Td>
                        <Td>
                          <Icon
                            as={field.required ? FiCheck : FiX}
                            color={field.required ? 'green.500' : 'gray.400'}
                          />
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
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

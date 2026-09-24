import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  HStack,
  Alert,
  AlertIcon,
  Text,
  Icon,
  Box,
  useToast,
  FormHelperText,
  Select,
  IconButton,
  Tooltip,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Checkbox,
  Badge,
} from '@chakra-ui/react'
import { FiDatabase, FiPlus, FiTrash2 } from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import { springs } from '../../utils/animations'

// Iceberg supported primitive types
const ICEBERG_TYPES = [
  { value: 'boolean', label: 'Boolean' },
  { value: 'int', label: 'Integer (32-bit)' },
  { value: 'long', label: 'Long (64-bit)' },
  { value: 'float', label: 'Float (32-bit)' },
  { value: 'double', label: 'Double (64-bit)' },
  { value: 'decimal(10,2)', label: 'Decimal' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'timestamptz', label: 'Timestamp with TZ' },
  { value: 'string', label: 'String' },
  { value: 'uuid', label: 'UUID' },
  { value: 'binary', label: 'Binary' },
]

interface FieldDef {
  id: number
  name: string
  type: string
  required: boolean
  doc: string
}

export default function IcebergTableDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Form fields
  const [tableName, setTableName] = useState('')
  const [fields, setFields] = useState<FieldDef[]>([
    { id: 1, name: '', type: 'string', required: false, doc: '' },
  ])

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOpen = activeDialog === 'icebergtable'
  const connectionId = dialogData?.data?.connectionId as string | undefined
  const connectionName = dialogData?.data?.connectionName as string | undefined
  const namespace = dialogData?.data?.namespace as string | undefined

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTableName('')
      setFields([{ id: 1, name: '', type: 'string', required: false, doc: '' }])
      setError(null)
    }
  }, [isOpen])

  const addField = () => {
    const maxId = Math.max(...fields.map((f) => f.id), 0)
    setFields([...fields, { id: maxId + 1, name: '', type: 'string', required: false, doc: '' }])
  }

  const removeField = (id: number) => {
    if (fields.length > 1) {
      setFields(fields.filter((f) => f.id !== id))
    }
  }

  const updateField = (id: number, updates: Partial<FieldDef>) => {
    setFields(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)))
  }

  const handleSubmit = async () => {
    setIsLoading(true)
    setError(null)

    try {
      if (!tableName) {
        toast({
          title: 'Required fields',
          description: 'Table name is required',
          status: 'warning',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      // Validate table name
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        toast({
          title: 'Invalid name',
          description: 'Table name must start with a letter or underscore and contain only alphanumeric characters and underscores',
          status: 'warning',
          duration: 5000,
        })
        setIsLoading(false)
        return
      }

      // Validate fields
      const validFields = fields.filter((f) => f.name.trim() !== '')
      if (validFields.length === 0) {
        toast({
          title: 'Required fields',
          description: 'At least one column is required',
          status: 'warning',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      // Check for duplicate field names
      const fieldNames = validFields.map((f) => f.name.toLowerCase())
      const uniqueNames = new Set(fieldNames)
      if (uniqueNames.size !== fieldNames.length) {
        toast({
          title: 'Duplicate column names',
          description: 'Column names must be unique',
          status: 'warning',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      if (!connectionId || !namespace) {
        toast({
          title: 'Error',
          description: 'No connection or namespace selected',
          status: 'error',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      const schemaFields = validFields.map((f, idx) => ({
        id: idx + 1,
        name: f.name,
        type: f.type,
        required: f.required,
        doc: f.doc || undefined,
      }))

      await api.createIcebergTable(connectionId, namespace, {
        name: tableName,
        schema: {
          type: 'struct',
          fields: schemaFields,
        },
      })

      toast({
        title: 'Table created',
        description: `Created table "${tableName}" in namespace "${namespace}"`,
        status: 'success',
        duration: 2000,
      })

      // Refresh tables list
      queryClient.invalidateQueries({ queryKey: ['icebergtables', connectionId, namespace] })
      closeDialog()
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      toast({
        title: 'Error',
        description: message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxW="800px">
        {/* Gradient Header */}
        <Box
          bg="surface.header"
          p={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiDatabase} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Create Table
              </Text>
              <HStack spacing={2}>
                <Text color="whiteAlpha.800" fontSize="sm">
                  {connectionName || 'Iceberg Catalog'}
                </Text>
                {namespace && (
                  <>
                    <Text color="whiteAlpha.600" fontSize="sm">/</Text>
                    <Badge colorScheme="cyan" variant="subtle" fontSize="xs">
                      {namespace}
                    </Badge>
                  </>
                )}
              </HStack>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6} maxH="60vh" overflowY="auto">
          <VStack spacing={4} align="stretch">
            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Table Name</FormLabel>
              <Input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="my_table"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                Use lowercase letters, numbers, and underscores only
              </FormHelperText>
            </FormControl>

            <FormControl>
              <HStack justify="space-between" mb={2}>
                <FormLabel fontWeight="500" color="gray.700" mb={0}>
                  Columns
                </FormLabel>
                <Tooltip label="Add column">
                  <IconButton
                    aria-label="Add column"
                    icon={<FiPlus />}
                    size="sm"
                    colorScheme="cyan"
                    onClick={addField}
                  />
                </Tooltip>
              </HStack>
              <Box borderWidth="1px" borderRadius="lg" overflow="hidden">
                <Table size="sm">
                  <Thead bg="gray.50">
                    <Tr>
                      <Th>Name</Th>
                      <Th>Type</Th>
                      <Th w="70px" textAlign="center">Required</Th>
                      <Th w="50px"></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {fields.map((field) => (
                      <Tr key={field.id}>
                        <Td>
                          <Input
                            value={field.name}
                            onChange={(e) => updateField(field.id, { name: e.target.value })}
                            placeholder="column_name"
                            size="sm"
                            borderRadius="md"
                          />
                        </Td>
                        <Td>
                          <Select
                            value={field.type}
                            onChange={(e) => updateField(field.id, { type: e.target.value })}
                            size="sm"
                            borderRadius="md"
                          >
                            {ICEBERG_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </Select>
                        </Td>
                        <Td textAlign="center">
                          <Checkbox
                            isChecked={field.required}
                            onChange={(e) => updateField(field.id, { required: e.target.checked })}
                          />
                        </Td>
                        <Td>
                          <Tooltip label="Remove column">
                            <IconButton
                              aria-label="Remove column"
                              icon={<FiTrash2 />}
                              size="xs"
                              variant="ghost"
                              colorScheme="red"
                              onClick={() => removeField(field.id)}
                              isDisabled={fields.length === 1}
                            />
                          </Tooltip>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
              <FormHelperText>
                Define the schema for your Iceberg table
              </FormHelperText>
            </FormControl>

            {/* Error display */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={springs.snappy}
                  style={{ width: '100%' }}
                >
                  <Alert
                    status="error"
                    borderRadius="lg"
                    variant="subtle"
                  >
                    <AlertIcon />
                    <Text fontSize="sm">{error}</Text>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>
          </VStack>
        </ModalBody>

        <ModalFooter
          gap={3}
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          <Button variant="ghost" onClick={closeDialog} borderRadius="lg">
            Cancel
          </Button>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              colorScheme="cyan"
              onClick={handleSubmit}
              isLoading={isLoading}
              borderRadius="lg"
              px={6}
              leftIcon={<FiPlus />}
            >
              Create Table
            </Button>
          </motion.div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

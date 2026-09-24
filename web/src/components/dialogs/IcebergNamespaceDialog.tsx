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
  Textarea,
} from '@chakra-ui/react'
import { FiFolder, FiPlus } from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import { springs } from '../../utils/animations'

export default function IcebergNamespaceDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Form fields
  const [name, setName] = useState('')
  const [properties, setProperties] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOpen = activeDialog === 'icebergnamespace'
  const connectionId = dialogData?.data?.connectionId as string | undefined
  const connectionName = dialogData?.data?.connectionName as string | undefined

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setProperties('')
      setError(null)
    }
  }, [isOpen])

  const parseProperties = (propsString: string): Record<string, string> => {
    const props: Record<string, string> = {}
    if (!propsString.trim()) return props

    const lines = propsString.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim()
        const value = trimmed.substring(eqIndex + 1).trim()
        props[key] = value
      }
    }
    return props
  }

  const handleSubmit = async () => {
    setIsLoading(true)
    setError(null)

    try {
      if (!name) {
        toast({
          title: 'Required fields',
          description: 'Namespace name is required',
          status: 'warning',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      if (!connectionId) {
        toast({
          title: 'Error',
          description: 'No connection selected',
          status: 'error',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      // Validate namespace name (no dots or special characters)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        toast({
          title: 'Invalid name',
          description: 'Namespace name must start with a letter or underscore and contain only alphanumeric characters and underscores',
          status: 'warning',
          duration: 5000,
        })
        setIsLoading(false)
        return
      }

      const props = parseProperties(properties)
      await api.createIcebergNamespace(connectionId, name, props)

      toast({
        title: 'Namespace created',
        description: `Created namespace "${name}"`,
        status: 'success',
        duration: 2000,
      })

      // Refresh namespaces list
      queryClient.invalidateQueries({ queryKey: ['icebergnamespaces', connectionId] })
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
    <Modal isOpen={isOpen} onClose={closeDialog} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        {/* Gradient Header */}
        <Box
          bg="surface.header"
          p={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiFolder} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Create Namespace
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {connectionName || 'Iceberg Catalog'}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={4}>
            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Namespace Name</FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_namespace"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                Use lowercase letters, numbers, and underscores only
              </FormHelperText>
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Properties (optional)</FormLabel>
              <Textarea
                value={properties}
                onChange={(e) => setProperties(e.target.value)}
                placeholder="location=s3://my-bucket/warehouse&#10;owner=data-team"
                size="md"
                borderRadius="lg"
                rows={4}
                fontFamily="mono"
                fontSize="sm"
              />
              <FormHelperText>
                Key=value pairs, one per line. Lines starting with # are ignored.
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
              Create Namespace
            </Button>
          </motion.div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

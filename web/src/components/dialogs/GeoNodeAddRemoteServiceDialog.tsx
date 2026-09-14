import { useState, useEffect } from 'react'
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
  Radio,
  RadioGroup,
  Spinner,
  Alert,
  AlertIcon,
  useToast,
} from '@chakra-ui/react'
import { FiGlobe, FiServer, FiPlus } from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import type { Connection } from '../../types'

export default function GeoNodeAddRemoteServiceDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [connections, setConnections] = useState<Connection[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [loadingConnections, setLoadingConnections] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOpen = activeDialog === 'geonodeaddremoteservice'
  const geonodeConnId = dialogData?.data?.connectionId as string | undefined

  useEffect(() => {
    if (!isOpen) return
    setSelectedId('')
    setError(null)
    setLoadingConnections(true)
    api.getConnections()
      .then(setConnections)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingConnections(false))
  }, [isOpen])

  const handleSubmit = async () => {
    if (!selectedId) {
      toast({ title: 'Select a GeoServer connection', status: 'warning', duration: 3000 })
      return
    }
    if (!geonodeConnId) return

    setIsSubmitting(true)
    setError(null)
    try {
      await api.createGeoNodeRemoteService(geonodeConnId, selectedId)
      toast({ title: 'Remote service added', status: 'success', duration: 2000 })
      queryClient.invalidateQueries({ queryKey: ['geonoderemoteservices', geonodeConnId] })
      closeDialog()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast({ title: 'Error', description: msg, status: 'error', duration: 5000 })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="md" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        {/* Header */}
        <Box bg="linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)" p={4}>
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiGlobe} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Add Remote Service
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                Select a GeoServer to register as a WMS remote service
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={5}>
          {loadingConnections ? (
            <HStack justify="center" py={6}>
              <Spinner size="sm" color="teal.500" />
              <Text color="gray.500" fontSize="sm">Loading GeoServer connections…</Text>
            </HStack>
          ) : connections.length === 0 ? (
            <Text color="gray.500" fontSize="sm" textAlign="center" py={4}>
              No GeoServer connections found. Add one first.
            </Text>
          ) : (
            <RadioGroup value={selectedId} onChange={setSelectedId}>
              <VStack align="stretch" spacing={2}>
                {connections.map((conn) => (
                  <Box
                    key={conn.id}
                    as="label"
                    htmlFor={conn.id}
                    cursor="pointer"
                    borderWidth="1px"
                    borderRadius="lg"
                    px={4}
                    py={3}
                    borderColor={selectedId === conn.id ? 'teal.400' : 'gray.200'}
                    bg={selectedId === conn.id ? 'teal.50' : 'white'}
                    _hover={{ borderColor: 'teal.300', bg: 'teal.50' }}
                    transition="all 0.15s"
                  >
                    <HStack spacing={3}>
                      <Radio id={conn.id} value={conn.id} colorScheme="teal" />
                      <Icon as={FiServer} color="teal.500" />
                      <Box minW={0}>
                        <Text fontWeight="500" fontSize="sm" noOfLines={1}>
                          {conn.name}
                        </Text>
                        <Text color="gray.500" fontSize="xs" noOfLines={1}>
                          {conn.url}
                        </Text>
                      </Box>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            </RadioGroup>
          )}

          {error && (
            <Alert status="error" borderRadius="lg" mt={3}>
              <AlertIcon />
              <Text fontSize="sm">{error}</Text>
            </Alert>
          )}
        </ModalBody>

        <ModalFooter gap={3} borderTop="1px solid" borderTopColor="gray.100" bg="gray.50">
          <Button variant="ghost" onClick={closeDialog} borderRadius="lg">
            Cancel
          </Button>
          <Button
            colorScheme="teal"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            isDisabled={!selectedId || loadingConnections}
            borderRadius="lg"
            px={6}
            leftIcon={<FiPlus />}
          >
            Add Service
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
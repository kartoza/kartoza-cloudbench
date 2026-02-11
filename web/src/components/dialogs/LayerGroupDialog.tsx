import { useState, useEffect } from 'react'
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
  Select,
  VStack,
  HStack,
  Box,
  Text,
  Icon,
  Checkbox,
  Stack,
  Badge,
  Spinner,
  Alert,
  AlertIcon,
  useToast,
} from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FiGrid, FiLayers } from 'react-icons/fi'
import { useUIStore } from '../../stores/uiStore'
import { useTreeStore } from '../../stores/treeStore'
import * as api from '../../api/client'

export default function LayerGroupDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'SINGLE' | 'NAMED' | 'CONTAINER' | 'EO'>('SINGLE')
  const [selectedLayers, setSelectedLayers] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const toast = useToast()
  const queryClient = useQueryClient()

  const isOpen = activeDialog === 'layergroup'
  const isEditMode = dialogData?.mode === 'edit'

  // Get connection ID and workspace from selected node or dialog data
  const connectionId = (dialogData?.data?.connectionId as string) || selectedNode?.connectionId || ''
  const workspace = (dialogData?.data?.workspace as string) || selectedNode?.workspace || ''

  // Fetch layers for the workspace
  const { data: layers, isLoading: isLoadingLayers } = useQuery({
    queryKey: ['layers', connectionId, workspace],
    queryFn: () => api.getLayers(connectionId, workspace),
    enabled: isOpen && !!connectionId && !!workspace,
  })

  useEffect(() => {
    if (isOpen) {
      if (isEditMode && dialogData?.data) {
        setName((dialogData.data.name as string) || '')
        setTitle((dialogData.data.title as string) || '')
        setMode((dialogData.data.mode as 'SINGLE' | 'NAMED' | 'CONTAINER' | 'EO') || 'SINGLE')
        setSelectedLayers((dialogData.data.layers as string[]) || [])
      } else {
        setName('')
        setTitle('')
        setMode('SINGLE')
        setSelectedLayers([])
      }
    }
  }, [isOpen, isEditMode, dialogData])

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: 'Name is required',
        status: 'error',
        duration: 3000,
      })
      return
    }

    if (selectedLayers.length === 0) {
      toast({
        title: 'Select at least one layer',
        status: 'error',
        duration: 3000,
      })
      return
    }

    setIsLoading(true)

    try {
      // Format layer names as workspace:layer
      const formattedLayers = selectedLayers.map((layer) => `${workspace}:${layer}`)

      if (isEditMode) {
        // Update existing layer group
        await api.updateLayerGroup(connectionId, workspace, name, {
          title: title.trim() || undefined,
          mode,
          layers: formattedLayers,
          enabled: true,
        })

        toast({
          title: `Layer group "${name}" updated successfully`,
          status: 'success',
          duration: 3000,
        })
      } else {
        // Create new layer group
        await api.createLayerGroup(connectionId, workspace, {
          name: name.trim(),
          title: title.trim() || undefined,
          mode,
          layers: formattedLayers,
        })

        toast({
          title: `Layer group "${name}" created successfully`,
          status: 'success',
          duration: 3000,
        })
      }

      // Invalidate layer groups query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['layergroups', connectionId, workspace] })

      closeDialog()
    } catch (err) {
      toast({
        title: isEditMode ? 'Failed to update layer group' : 'Failed to create layer group',
        description: err instanceof Error ? err.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleLayerToggle = (layerName: string) => {
    setSelectedLayers((prev) =>
      prev.includes(layerName)
        ? prev.filter((l) => l !== layerName)
        : [...prev, layerName]
    )
  }

  const handleSelectAll = () => {
    if (layers) {
      if (selectedLayers.length === layers.length) {
        setSelectedLayers([])
      } else {
        setSelectedLayers(layers.map((l) => l.name))
      }
    }
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="85vh">
        {/* Gradient Header */}
        <Box
          bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiGrid} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {isEditMode ? 'Edit Layer Group' : 'Create Layer Group'}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {workspace ? `Workspace: ${workspace}` : 'Select layers to group together'}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6} overflowY="auto">
          <VStack spacing={5} align="stretch">
            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Group Name</FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_layer_group"
                size="lg"
                borderRadius="lg"
                isDisabled={isEditMode}
              />
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Title (Optional)</FormLabel>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My Layer Group"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Mode</FormLabel>
              <Select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'SINGLE' | 'NAMED' | 'CONTAINER' | 'EO')}
                size="lg"
                borderRadius="lg"
              >
                <option value="SINGLE">Single (merged into one layer)</option>
                <option value="NAMED">Named (layers visible separately)</option>
                <option value="CONTAINER">Container (organizational only)</option>
                <option value="EO">EO (Earth Observation)</option>
              </Select>
            </FormControl>

            <FormControl isRequired>
              <HStack justify="space-between" mb={2}>
                <FormLabel fontWeight="500" color="gray.700" mb={0}>
                  Select Layers
                </FormLabel>
                <HStack>
                  <Badge colorScheme="kartoza" borderRadius="md" px={2}>
                    {selectedLayers.length} selected
                  </Badge>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorScheme="kartoza"
                    onClick={handleSelectAll}
                  >
                    {layers && selectedLayers.length === layers.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </HStack>
              </HStack>

              <Box
                border="1px solid"
                borderColor="gray.200"
                borderRadius="lg"
                maxH="250px"
                overflowY="auto"
                p={3}
              >
                {isLoadingLayers ? (
                  <HStack justify="center" py={6}>
                    <Spinner size="sm" color="kartoza.500" />
                    <Text fontSize="sm" color="gray.500">Loading layers...</Text>
                  </HStack>
                ) : layers && layers.length > 0 ? (
                  <Stack spacing={2}>
                    {layers.map((layer) => (
                      <Box
                        key={layer.name}
                        p={2}
                        borderRadius="md"
                        bg={selectedLayers.includes(layer.name) ? 'kartoza.50' : 'transparent'}
                        _hover={{ bg: 'gray.50' }}
                        transition="background 0.15s"
                      >
                        <Checkbox
                          isChecked={selectedLayers.includes(layer.name)}
                          onChange={() => handleLayerToggle(layer.name)}
                          colorScheme="kartoza"
                        >
                          <HStack spacing={2}>
                            <Icon as={FiLayers} color="blue.500" />
                            <Text fontSize="sm" fontWeight={selectedLayers.includes(layer.name) ? '500' : 'normal'}>
                              {layer.name}
                            </Text>
                            {layer.storeType && (
                              <Badge
                                size="sm"
                                colorScheme={layer.storeType === 'coverage' ? 'purple' : 'green'}
                                fontSize="xs"
                              >
                                {layer.storeType === 'coverage' ? 'Raster' : 'Vector'}
                              </Badge>
                            )}
                          </HStack>
                        </Checkbox>
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Alert status="info" borderRadius="md">
                    <AlertIcon />
                    <Text fontSize="sm">No layers available in this workspace</Text>
                  </Alert>
                )}
              </Box>
            </FormControl>
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
          <Button
            colorScheme="kartoza"
            onClick={handleSubmit}
            isLoading={isLoading}
            isDisabled={!name.trim() || selectedLayers.length === 0}
            borderRadius="lg"
            px={6}
          >
            {isEditMode ? 'Save Changes' : 'Create Layer Group'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

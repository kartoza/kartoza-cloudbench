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
  Switch,
  VStack,
  HStack,
  SimpleGrid,
  Heading,
  Box,
  Text,
  Icon,
  useToast,
} from '@chakra-ui/react'
import { FiFolder } from 'react-icons/fi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import { useTreeStore } from '../../stores/treeStore'
import { useConnectionStore } from '../../stores/connectionStore'
import * as api from '../../api/client'
import type { WorkspaceConfig } from '../../types'

const defaultConfig: WorkspaceConfig = {
  name: '',
  isolated: false,
  default: false,
  enabled: true,
  wmtsEnabled: false,
  wmsEnabled: true,
  wcsEnabled: true,
  wpsEnabled: false,
  wfsEnabled: true,
}

export default function WorkspaceDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)

  const selectedNode = useTreeStore((state) => state.selectedNode)
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [config, setConfig] = useState<WorkspaceConfig>(defaultConfig)
  const [isLoading, setIsLoading] = useState(false)

  const isOpen = activeDialog === 'workspace'
  const isEditMode = dialogData?.mode === 'edit'
  const connectionId = (dialogData?.data?.connectionId as string) || selectedNode?.connectionId || activeConnectionId
  const workspaceName = dialogData?.data?.workspace as string | undefined

  // Fetch existing workspace config in edit mode
  const { data: existingConfig } = useQuery({
    queryKey: ['workspace', connectionId, workspaceName],
    queryFn: () => api.getWorkspace(connectionId!, workspaceName!),
    enabled: isOpen && isEditMode && !!connectionId && !!workspaceName,
  })

  useEffect(() => {
    if (isOpen) {
      if (isEditMode && existingConfig) {
        setConfig(existingConfig)
      } else {
        setConfig(defaultConfig)
      }
    }
  }, [isOpen, isEditMode, existingConfig])

  const updateField = <K extends keyof WorkspaceConfig>(field: K, value: WorkspaceConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    if (!connectionId) {
      toast({
        title: 'No connection selected',
        description: 'Please select a connection first',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    if (!config.name) {
      toast({
        title: 'Name required',
        description: 'Please enter a workspace name',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsLoading(true)

    try {
      if (isEditMode && workspaceName) {
        await api.updateWorkspace(connectionId, workspaceName, config)
        toast({
          title: 'Workspace updated',
          status: 'success',
          duration: 2000,
        })
      } else {
        await api.createWorkspace(connectionId, config)
        toast({
          title: 'Workspace created',
          status: 'success',
          duration: 2000,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['workspaces', connectionId] })
      closeDialog()
    } catch (err) {
      toast({
        title: 'Error',
        description: (err as Error).message,
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
          bg="linear-gradient(135deg, #E8A331 0%, #F0B84D 100%)"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiFolder} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {isEditMode ? 'Edit Workspace' : 'Create Workspace'}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {isEditMode ? 'Update workspace settings' : 'Create a new GeoServer workspace'}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={5} align="stretch">
            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Workspace Name</FormLabel>
              <Input
                value={config.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="my_workspace"
                isDisabled={isEditMode}
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <Box
              p={4}
              bg="gray.50"
              borderRadius="lg"
            >
              <Heading size="sm" mb={3} color="gray.700">
                Workspace Settings
              </Heading>
              <SimpleGrid columns={3} spacing={4}>
                <FormControl display="flex" alignItems="center" justifyContent="space-between">
                  <FormLabel mb={0} fontWeight="normal">Isolated</FormLabel>
                  <Switch
                    isChecked={config.isolated}
                    onChange={(e) => updateField('isolated', e.target.checked)}
                    colorScheme="kartoza"
                  />
                </FormControl>

                <FormControl display="flex" alignItems="center" justifyContent="space-between">
                  <FormLabel mb={0} fontWeight="normal">Default</FormLabel>
                  <Switch
                    isChecked={config.default}
                    onChange={(e) => updateField('default', e.target.checked)}
                    colorScheme="kartoza"
                  />
                </FormControl>

                <FormControl display="flex" alignItems="center" justifyContent="space-between">
                  <FormLabel mb={0} fontWeight="normal">Enabled</FormLabel>
                  <Switch
                    isChecked={config.enabled}
                    onChange={(e) => updateField('enabled', e.target.checked)}
                    colorScheme="kartoza"
                  />
                </FormControl>
              </SimpleGrid>
            </Box>

            <Box
              p={4}
              bg="gray.50"
              borderRadius="lg"
            >
              <Heading size="sm" mb={3} color="gray.700">
                OGC Services
              </Heading>
              <SimpleGrid columns={5} spacing={4}>
                <FormControl display="flex" alignItems="center" flexDirection="column" gap={1}>
                  <FormLabel mb={0} fontSize="sm" fontWeight="500" color="gray.600">
                    WMS
                  </FormLabel>
                  <Switch
                    isChecked={config.wmsEnabled}
                    onChange={(e) => updateField('wmsEnabled', e.target.checked)}
                    colorScheme="kartoza"
                    size="md"
                  />
                </FormControl>

                <FormControl display="flex" alignItems="center" flexDirection="column" gap={1}>
                  <FormLabel mb={0} fontSize="sm" fontWeight="500" color="gray.600">
                    WFS
                  </FormLabel>
                  <Switch
                    isChecked={config.wfsEnabled}
                    onChange={(e) => updateField('wfsEnabled', e.target.checked)}
                    colorScheme="kartoza"
                    size="md"
                  />
                </FormControl>

                <FormControl display="flex" alignItems="center" flexDirection="column" gap={1}>
                  <FormLabel mb={0} fontSize="sm" fontWeight="500" color="gray.600">
                    WCS
                  </FormLabel>
                  <Switch
                    isChecked={config.wcsEnabled}
                    onChange={(e) => updateField('wcsEnabled', e.target.checked)}
                    colorScheme="kartoza"
                    size="md"
                  />
                </FormControl>

                <FormControl display="flex" alignItems="center" flexDirection="column" gap={1}>
                  <FormLabel mb={0} fontSize="sm" fontWeight="500" color="gray.600">
                    WMTS
                  </FormLabel>
                  <Switch
                    isChecked={config.wmtsEnabled}
                    onChange={(e) => updateField('wmtsEnabled', e.target.checked)}
                    colorScheme="kartoza"
                    size="md"
                  />
                </FormControl>

                <FormControl display="flex" alignItems="center" flexDirection="column" gap={1}>
                  <FormLabel mb={0} fontSize="sm" fontWeight="500" color="gray.600">
                    WPS
                  </FormLabel>
                  <Switch
                    isChecked={config.wpsEnabled}
                    onChange={(e) => updateField('wpsEnabled', e.target.checked)}
                    colorScheme="kartoza"
                    size="md"
                  />
                </FormControl>
              </SimpleGrid>
            </Box>
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
            borderRadius="lg"
            px={6}
          >
            {isEditMode ? 'Save Changes' : 'Create Workspace'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

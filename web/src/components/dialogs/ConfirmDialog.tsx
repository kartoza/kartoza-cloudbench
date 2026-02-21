import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  Text,
  HStack,
  Box,
  Icon,
  useToast,
} from '@chakra-ui/react'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FiAlertTriangle } from 'react-icons/fi'
import { useUIStore } from '../../stores/uiStore'
import { useConnectionStore } from '../../stores/connectionStore'
import * as api from '../../api/client'

export default function ConfirmDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const removeConnection = useConnectionStore((state) => state.removeConnection)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [isLoading, setIsLoading] = useState(false)

  const isOpen = activeDialog === 'confirm'
  const title = dialogData?.title || 'Confirm'
  const message = dialogData?.message || 'Are you sure?'
  const data = dialogData?.data as Record<string, unknown> | undefined

  const handleConfirm = async () => {
    setIsLoading(true)

    try {
      // Handle different delete types based on data
      if (data?.s3ConnectionId && data?.s3BucketName && data?.s3ObjectKey) {
        // Delete S3 object or folder
        await api.deleteS3Object(
          data.s3ConnectionId as string,
          data.s3BucketName as string,
          data.s3ObjectKey as string
        )
        // Invalidate all S3 object queries for this bucket to refresh the tree
        // Use predicate to match any query starting with ['s3objects', connectionId, bucketName, ...]
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === 's3objects' &&
            query.queryKey[1] === data.s3ConnectionId &&
            query.queryKey[2] === data.s3BucketName
        })
        toast({
          title: 'Deleted successfully',
          status: 'success',
          duration: 2000,
        })
      } else if (data?.pgServiceName) {
        // Delete PostgreSQL service
        await api.deletePGService(data.pgServiceName as string)
        queryClient.invalidateQueries({ queryKey: ['pgservices'] })
        toast({
          title: 'PostgreSQL service deleted',
          status: 'success',
          duration: 2000,
        })
      } else if (data?.connectionId && !data?.workspace) {
        // Delete connection
        await removeConnection(data.connectionId as string)
        // Also invalidate dashboard to update the display
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        toast({
          title: 'Connection deleted',
          status: 'success',
          duration: 2000,
        })
      } else if (data?.connectionId && data?.workspace && !data?.name) {
        // Delete workspace
        await api.deleteWorkspace(
          data.connectionId as string,
          data.workspace as string,
          true // recurse
        )
        queryClient.invalidateQueries({ queryKey: ['workspaces', data.connectionId] })
        toast({
          title: 'Workspace deleted',
          status: 'success',
          duration: 2000,
        })
      } else if (data?.connectionId && data?.workspace && data?.name && data?.type) {
        // Delete specific resource
        const connId = data.connectionId as string
        const workspace = data.workspace as string
        const name = data.name as string
        const type = data.type as string

        switch (type) {
          case 'datastore':
            await api.deleteDataStore(connId, workspace, name, true)
            queryClient.invalidateQueries({ queryKey: ['datastores', connId, workspace] })
            break
          case 'coveragestore':
            await api.deleteCoverageStore(connId, workspace, name, true)
            queryClient.invalidateQueries({ queryKey: ['coveragestores', connId, workspace] })
            break
          case 'layer':
            await api.deleteLayer(connId, workspace, name)
            queryClient.invalidateQueries({ queryKey: ['layers', connId, workspace] })
            break
          case 'style':
            await api.deleteStyle(connId, workspace, name, true)
            queryClient.invalidateQueries({ queryKey: ['styles', connId, workspace] })
            break
          case 'layergroup':
            await api.deleteLayerGroup(connId, workspace, name)
            queryClient.invalidateQueries({ queryKey: ['layergroups', connId, workspace] })
            break
        }

        toast({
          title: `${type} deleted`,
          status: 'success',
          duration: 2000,
        })
      }

      // Call custom onConfirm if provided
      if (dialogData?.onConfirm) {
        await dialogData.onConfirm()
      }

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
    <Modal isOpen={isOpen} onClose={closeDialog} size="md" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        {/* Warning Header - Red gradient for destructive action */}
        <Box
          bg="linear-gradient(135deg, #7f1d1d 0%, #b91c1c 50%, #dc2626 100%)"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiAlertTriangle} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {title}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                This action cannot be undone
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <Text color="gray.700" fontSize="md">
            {message}
          </Text>
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
            colorScheme="red"
            onClick={handleConfirm}
            isLoading={isLoading}
            borderRadius="lg"
            px={6}
          >
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

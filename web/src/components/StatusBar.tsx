import {
  Box,
  Flex,
  Text,
  useColorModeValue,
  Alert,
  AlertIcon,
  CloseButton,
} from '@chakra-ui/react'
import { useUIStore } from '../stores/uiStore'
import { useConnectionStore } from '../stores/connectionStore'

export default function StatusBar() {
  const bgColor = useColorModeValue('gray.100', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  const statusMessage = useUIStore((state) => state.statusMessage)
  const errorMessage = useUIStore((state) => state.errorMessage)
  const successMessage = useUIStore((state) => state.successMessage)
  const setError = useUIStore((state) => state.setError)
  const setSuccess = useUIStore((state) => state.setSuccess)

  const connections = useConnectionStore((state) => state.connections)
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)

  const activeConnection = connections.find((c) => c.id === activeConnectionId)

  return (
    <Box>
      {errorMessage && (
        <Alert status="error" variant="solid">
          <AlertIcon />
          <Text flex="1">{errorMessage}</Text>
          <CloseButton onClick={() => setError(null)} />
        </Alert>
      )}
      {successMessage && (
        <Alert status="success" variant="solid">
          <AlertIcon />
          <Text flex="1">{successMessage}</Text>
          <CloseButton onClick={() => setSuccess(null)} />
        </Alert>
      )}
      <Box
        bg={bgColor}
        borderTop="1px"
        borderColor={borderColor}
        px={4}
        py={1}
      >
        <Flex justify="space-between" align="center">
          <Text fontSize="sm" color="gray.600">
            {statusMessage}
          </Text>
          <Flex gap={4}>
            <Text fontSize="sm" color="gray.600">
              Connections: {connections.length}
            </Text>
            {activeConnection && (
              <Text fontSize="sm" color="kartoza.500" fontWeight="medium">
                Active: {activeConnection.name}
              </Text>
            )}
          </Flex>
        </Flex>
      </Box>
    </Box>
  )
}

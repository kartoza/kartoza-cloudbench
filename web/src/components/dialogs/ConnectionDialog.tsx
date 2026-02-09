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
  InputGroup,
  InputRightElement,
  IconButton,
  VStack,
  HStack,
  Alert,
  AlertIcon,
  Text,
  Icon,
  Box,
  useToast,
} from '@chakra-ui/react'
import { FiEye, FiEyeOff, FiServer, FiCheck } from 'react-icons/fi'
import { useUIStore } from '../../stores/uiStore'
import { useConnectionStore } from '../../stores/connectionStore'

export default function ConnectionDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)

  const addConnection = useConnectionStore((state) => state.addConnection)
  const updateConnection = useConnectionStore((state) => state.updateConnection)
  const testConnection = useConnectionStore((state) => state.testConnection)
  const connections = useConnectionStore((state) => state.connections)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const toast = useToast()
  const isOpen = activeDialog === 'connection'
  const isEditMode = dialogData?.mode === 'edit'
  const connectionId = dialogData?.data?.connectionId as string | undefined

  // Load existing data in edit mode
  useEffect(() => {
    if (isOpen && isEditMode && connectionId) {
      const conn = connections.find((c) => c.id === connectionId)
      if (conn) {
        setName(conn.name)
        setUrl(conn.url)
        setUsername(conn.username)
        setPassword(conn.password || '')
        setShowPassword(false) // Reset to hidden when opening
      }
    } else if (isOpen && !isEditMode) {
      setName('')
      setUrl('')
      setUsername('')
      setPassword('')
      setShowPassword(false)
    }
    setTestResult(null)
  }, [isOpen, isEditMode, connectionId, connections])

  const handleTest = async () => {
    if (!connectionId && !url) {
      toast({
        title: 'URL required',
        description: 'Please enter a GeoServer URL first',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsTesting(true)
    setTestResult(null)

    try {
      // For new connections, we need to create a temporary connection to test
      if (!connectionId) {
        // Create temp connection
        const tempConn = await addConnection({ name: name || 'Test', url, username, password })
        const result = await testConnection(tempConn.id)
        // Delete temp if test was just for validation
        // Actually keep it if test succeeds
        if (!result.success) {
          await useConnectionStore.getState().removeConnection(tempConn.id)
        }
        setTestResult(result)
      } else {
        const result = await testConnection(connectionId)
        setTestResult(result)
      }
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSubmit = async () => {
    if (!name || !url) {
      toast({
        title: 'Required fields',
        description: 'Name and URL are required',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsLoading(true)

    try {
      if (isEditMode && connectionId) {
        await updateConnection(connectionId, { name, url, username, password: password || undefined })
        toast({
          title: 'Connection updated',
          status: 'success',
          duration: 2000,
        })
      } else {
        await addConnection({ name, url, username, password })
        toast({
          title: 'Connection added',
          status: 'success',
          duration: 2000,
        })
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
    <Modal isOpen={isOpen} onClose={closeDialog} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        {/* Gradient Header */}
        <Box
          bg="linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiServer} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {isEditMode ? 'Edit Connection' : 'Add Connection'}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {isEditMode ? 'Update your GeoServer connection' : 'Connect to a GeoServer instance'}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={4}>
            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Name</FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My GeoServer"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">URL</FormLabel>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:8080/geoserver"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Username</FormLabel>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Password</FormLabel>
              <InputGroup size="lg">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEditMode ? '(unchanged)' : 'password'}
                  borderRadius="lg"
                />
                <InputRightElement h="full">
                  <IconButton
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    icon={showPassword ? <FiEyeOff /> : <FiEye />}
                    variant="ghost"
                    size="md"
                    onClick={() => setShowPassword(!showPassword)}
                  />
                </InputRightElement>
              </InputGroup>
            </FormControl>

            {testResult && (
              <Alert
                status={testResult.success ? 'success' : 'error'}
                borderRadius="lg"
                variant="subtle"
              >
                <AlertIcon />
                <Text fontSize="sm">{testResult.message}</Text>
              </Alert>
            )}
          </VStack>
        </ModalBody>

        <ModalFooter
          gap={3}
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          <Button
            variant="outline"
            onClick={handleTest}
            isLoading={isTesting}
            loadingText="Testing..."
            leftIcon={<FiCheck />}
            borderRadius="lg"
            flexShrink={0}
          >
            Test Connection
          </Button>
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
            {isEditMode ? 'Save Changes' : 'Add Connection'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

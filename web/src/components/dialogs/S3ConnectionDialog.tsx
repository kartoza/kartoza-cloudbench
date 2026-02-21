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
  Switch,
  FormHelperText,
} from '@chakra-ui/react'
import { FiEye, FiEyeOff, FiHardDrive, FiCheck } from 'react-icons/fi'
import { SiAmazons3 } from 'react-icons/si'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api/client'
import { springs } from '../../utils/animations'

export default function S3ConnectionDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Form fields
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [region, setRegion] = useState('')
  const [useSSL, setUseSSL] = useState(true)
  const [pathStyle, setPathStyle] = useState(true)
  const [showSecretKey, setShowSecretKey] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; buckets?: number } | null>(null)

  const isOpen = activeDialog === 's3connection'
  const isEditMode = dialogData?.mode === 'edit'
  const connectionId = dialogData?.data?.connectionId as string | undefined

  // Load existing data in edit mode
  useEffect(() => {
    if (isOpen && isEditMode && connectionId) {
      // Fetch existing connection data
      api.getS3Connection(connectionId).then((conn) => {
        setName(conn.name)
        setEndpoint(conn.endpoint)
        setAccessKey(conn.accessKey)
        setSecretKey('') // Don't show existing secret key
        setRegion(conn.region || '')
        setUseSSL(conn.useSSL)
        setPathStyle(conn.pathStyle)
      }).catch((err) => {
        toast({
          title: 'Failed to load connection',
          description: err.message,
          status: 'error',
          duration: 5000,
        })
      })
    } else if (isOpen && !isEditMode) {
      // Reset all fields for new connection
      setName('')
      setEndpoint('localhost:9000')
      setAccessKey('')
      setSecretKey('')
      setRegion('')
      setUseSSL(false)
      setPathStyle(true)
      setShowSecretKey(false)
    }
    setTestResult(null)
  }, [isOpen, isEditMode, connectionId, toast])

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)

    try {
      if (!endpoint) {
        toast({
          title: 'Endpoint required',
          description: 'Please enter an S3 endpoint first',
          status: 'warning',
          duration: 3000,
        })
        setIsTesting(false)
        return
      }

      const result = await api.testS3ConnectionDirect({
        name: name || 'Test',
        endpoint,
        accessKey,
        secretKey,
        region: region || undefined,
        useSSL,
        pathStyle,
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSubmit = async () => {
    setIsLoading(true)

    try {
      if (!name || !endpoint) {
        toast({
          title: 'Required fields',
          description: 'Name and endpoint are required',
          status: 'warning',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      const connectionData = {
        name,
        endpoint,
        accessKey,
        secretKey,
        region: region || undefined,
        useSSL,
        pathStyle,
      }

      if (isEditMode && connectionId) {
        await api.updateS3Connection(connectionId, connectionData)
        toast({
          title: 'Connection updated',
          status: 'success',
          duration: 2000,
        })
      } else {
        await api.createS3Connection(connectionData)
        toast({
          title: 'Connection added',
          status: 'success',
          duration: 2000,
        })
      }

      // Refresh S3 connections list
      queryClient.invalidateQueries({ queryKey: ['s3connections'] })
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
          bg="linear-gradient(135deg, #c06c00 0%, #e08900 50%, #f0a020 100%)"
          p={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={SiAmazons3} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {isEditMode ? 'Edit S3 Connection' : 'Add S3 Connection'}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                Connect to S3-compatible storage (MinIO, AWS S3, Wasabi, etc.)
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={4}>
            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Connection Name</FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My S3 Storage"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Endpoint</FormLabel>
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="localhost:9000 or s3.amazonaws.com"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                For MinIO: localhost:9000, For AWS: s3.amazonaws.com
              </FormHelperText>
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Access Key</FormLabel>
              <Input
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Secret Key</FormLabel>
              <InputGroup size="lg">
                <Input
                  type={showSecretKey ? 'text' : 'password'}
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={isEditMode ? '(unchanged)' : 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'}
                  borderRadius="lg"
                />
                <InputRightElement h="full">
                  <IconButton
                    aria-label={showSecretKey ? 'Hide secret key' : 'Show secret key'}
                    icon={showSecretKey ? <FiEyeOff /> : <FiEye />}
                    variant="ghost"
                    size="md"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                  />
                </InputRightElement>
              </InputGroup>
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Region (optional)</FormLabel>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="us-east-1"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                Required for AWS S3, optional for MinIO
              </FormHelperText>
            </FormControl>

            <HStack w="100%" spacing={6}>
              <FormControl display="flex" alignItems="center">
                <FormLabel mb="0" fontWeight="500" color="gray.700">
                  Use SSL
                </FormLabel>
                <Switch
                  isChecked={useSSL}
                  onChange={(e) => setUseSSL(e.target.checked)}
                  colorScheme="orange"
                />
              </FormControl>

              <FormControl display="flex" alignItems="center">
                <FormLabel mb="0" fontWeight="500" color="gray.700">
                  Path Style
                </FormLabel>
                <Switch
                  isChecked={pathStyle}
                  onChange={(e) => setPathStyle(e.target.checked)}
                  colorScheme="orange"
                />
              </FormControl>
            </HStack>
            <Text fontSize="xs" color="gray.500" alignSelf="flex-start">
              Path Style: Enable for MinIO and most S3-compatible storage. Disable for AWS S3.
            </Text>

            {/* Test Result */}
            <AnimatePresence>
              {testResult && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={springs.snappy}
                  style={{ width: '100%' }}
                >
                  <Alert
                    status={testResult.success ? 'success' : 'error'}
                    borderRadius="lg"
                    variant="subtle"
                  >
                    <AlertIcon />
                    <Box>
                      <Text fontSize="sm">{testResult.message}</Text>
                      {testResult.success && testResult.buckets !== undefined && (
                        <Text fontSize="xs" color="gray.600">
                          Found {testResult.buckets} bucket{testResult.buckets !== 1 ? 's' : ''}
                        </Text>
                      )}
                    </Box>
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
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              colorScheme="orange"
              onClick={handleSubmit}
              isLoading={isLoading}
              borderRadius="lg"
              px={6}
              leftIcon={<FiHardDrive />}
            >
              {isEditMode ? 'Save Changes' : 'Add Connection'}
            </Button>
          </motion.div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

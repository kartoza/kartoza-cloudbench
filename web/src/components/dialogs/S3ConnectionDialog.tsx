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
  Collapse,
} from '@chakra-ui/react'
import { FiEye, FiEyeOff, FiHardDrive, FiCheck, FiChevronDown, FiChevronRight } from 'react-icons/fi'
import { SiAmazons3 } from 'react-icons/si'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import { springs } from '../../utils/animations'

// Sensible connectivity defaults inferred from the endpoint, so most users
// never need to touch the advanced settings at all:
// - Real AWS S3 uses SSL and has deprecated path-style addressing.
// - Everything else (MinIO, Wasabi, R2, ...) generally needs path-style.
// - Bare localhost/127.0.0.1 dev instances usually run without TLS.
function deriveConnectionDefaults(endpoint: string): { useSSL: boolean; pathStyle: boolean } {
  const host = endpoint.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase()
  const isAWS = host.endsWith('amazonaws.com')
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
  return { useSSL: !isLocal, pathStyle: !isAWS }
}

export default function S3ConnectionDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Form fields
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [bucket, setBucket] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [region, setRegion] = useState('')
  const [useSSL, setUseSSL] = useState(true)
  const [pathStyle, setPathStyle] = useState(true)
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Once the user manually edits a connectivity toggle, stop silently
  // overwriting it whenever they change the endpoint.
  const [advancedTouched, setAdvancedTouched] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

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
        setBucket(conn.bucket)
        setAccessKey('') // Write-only — the API never returns the existing access key
        setSecretKey('') // Don't show existing secret key
        setRegion(conn.region || '')
        setUseSSL(conn.useSSL)
        setPathStyle(conn.pathStyle)
        // Flag as "touched" so re-typing the endpoint doesn't clobber this
        // connection's existing (possibly non-default) settings.
        setAdvancedTouched(true)
        setShowAdvanced(false)
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
      const defaultEndpoint = 'localhost:9000'
      setName('')
      setEndpoint(defaultEndpoint)
      setBucket('')
      setAccessKey('')
      setSecretKey('')
      setRegion('')
      setUseSSL(deriveConnectionDefaults(defaultEndpoint).useSSL)
      setPathStyle(deriveConnectionDefaults(defaultEndpoint).pathStyle)
      setShowSecretKey(false)
      setShowAdvanced(false)
      setAdvancedTouched(false)
    }
    setTestResult(null)
  }, [isOpen, isEditMode, connectionId, toast])

  const handleEndpointChange = (value: string) => {
    setEndpoint(value)
    if (!isEditMode && !advancedTouched) {
      const defaults = deriveConnectionDefaults(value)
      setUseSSL(defaults.useSSL)
      setPathStyle(defaults.pathStyle)
    }
  }

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
        bucket,
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
      if (!name || !endpoint || !bucket) {
        toast({
          title: 'Required fields',
          description: 'Name, endpoint and bucket are required',
          status: 'warning',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      const connectionData = {
        name,
        endpoint,
        bucket,
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
      <ModalContent borderRadius="xl" overflow="hidden" maxH="90vh">
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

        <ModalBody py={6} overflowY="auto">
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
                onChange={(e) => handleEndpointChange(e.target.value)}
                placeholder="localhost:9000 or s3.amazonaws.com"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                For MinIO: localhost:9000, For AWS: s3.amazonaws.com
              </FormHelperText>
            </FormControl>

            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Bucket</FormLabel>
              <Input
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                placeholder="my-bucket"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                Each connection is scoped to a single bucket.
              </FormHelperText>
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Access Key</FormLabel>
              <Input
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder={isEditMode ? '(unchanged)' : 'AKIAIOSFODNN7EXAMPLE'}
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

            <Box w="100%">
              <Button
                variant="link"
                size="sm"
                color="gray.600"
                fontWeight="500"
                leftIcon={showAdvanced ? <FiChevronDown /> : <FiChevronRight />}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                Advanced settings
              </Button>
              {!showAdvanced && (
                <Text fontSize="xs" color="gray.400" mt={1}>
                  Region, SSL and addressing style — auto-detected from the endpoint, override if needed.
                </Text>
              )}
              <Collapse in={showAdvanced} animateOpacity>
                <VStack spacing={4} align="stretch" pt={4}>
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
                        onChange={(e) => {
                          setAdvancedTouched(true)
                          setUseSSL(e.target.checked)
                        }}
                        colorScheme="orange"
                      />
                    </FormControl>

                    <FormControl display="flex" alignItems="center">
                      <FormLabel mb="0" fontWeight="500" color="gray.700">
                        Path Style
                      </FormLabel>
                      <Switch
                        isChecked={pathStyle}
                        onChange={(e) => {
                          setAdvancedTouched(true)
                          setPathStyle(e.target.checked)
                        }}
                        colorScheme="orange"
                      />
                    </FormControl>
                  </HStack>
                  <Text fontSize="xs" color="gray.500">
                    Path Style: on for MinIO and most S3-compatible storage, off for AWS S3.
                  </Text>
                </VStack>
              </Collapse>
            </Box>

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

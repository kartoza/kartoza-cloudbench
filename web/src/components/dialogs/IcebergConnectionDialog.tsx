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
  FormHelperText,
} from '@chakra-ui/react'
import { FiEye, FiEyeOff, FiCheck, FiServer } from 'react-icons/fi'
import { TbSnowflake } from 'react-icons/tb'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import { springs } from '../../utils/animations'

export default function IcebergConnectionDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Form fields
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [prefix, setPrefix] = useState('')
  const [s3Endpoint, setS3Endpoint] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [region, setRegion] = useState('')
  const [jupyterUrl, setJupyterUrl] = useState('')
  const [showSecretKey, setShowSecretKey] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; namespaceCount?: number } | null>(null)

  const isOpen = activeDialog === 'icebergconnection'
  const isEditMode = dialogData?.mode === 'edit'
  const connectionId = dialogData?.data?.connectionId as string | undefined

  // Load existing data in edit mode
  useEffect(() => {
    if (isOpen && isEditMode && connectionId) {
      // Fetch existing connection data
      api.getIcebergConnection(connectionId).then((conn) => {
        setName(conn.name)
        setUrl(conn.url)
        setPrefix(conn.prefix || '')
        setS3Endpoint(conn.s3Endpoint || '')
        setAccessKey(conn.accessKey || '')
        setSecretKey('') // Don't show existing secret key
        setRegion(conn.region || '')
        setJupyterUrl(conn.jupyterUrl || '')
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
      setUrl('http://localhost:8181')
      setPrefix('')
      setS3Endpoint('')
      setAccessKey('')
      setSecretKey('')
      setRegion('')
      setJupyterUrl('')
      setShowSecretKey(false)
    }
    setTestResult(null)
  }, [isOpen, isEditMode, connectionId, toast])

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)

    try {
      if (!url) {
        toast({
          title: 'URL required',
          description: 'Please enter an Iceberg REST catalog URL first',
          status: 'warning',
          duration: 3000,
        })
        setIsTesting(false)
        return
      }

      const result = await api.testIcebergConnectionDirect({
        name: name || 'Test',
        url,
        prefix: prefix || undefined,
        s3Endpoint: s3Endpoint || undefined,
        accessKey: accessKey || undefined,
        secretKey: secretKey || undefined,
        region: region || undefined,
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
      if (!name || !url) {
        toast({
          title: 'Required fields',
          description: 'Name and URL are required',
          status: 'warning',
          duration: 3000,
        })
        setIsLoading(false)
        return
      }

      const connectionData = {
        name,
        url,
        prefix: prefix || undefined,
        s3Endpoint: s3Endpoint || undefined,
        accessKey: accessKey || undefined,
        secretKey: secretKey || undefined,
        region: region || undefined,
        jupyterUrl: jupyterUrl || undefined,
      }

      if (isEditMode && connectionId) {
        await api.updateIcebergConnection(connectionId, connectionData)
        toast({
          title: 'Connection updated',
          status: 'success',
          duration: 2000,
        })
      } else {
        await api.createIcebergConnection(connectionData)
        toast({
          title: 'Connection added',
          status: 'success',
          duration: 2000,
        })
      }

      // Refresh Iceberg connections list
      queryClient.invalidateQueries({ queryKey: ['icebergconnections'] })
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
          bg="surface.header"
          p={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={TbSnowflake} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {isEditMode ? 'Edit Iceberg Catalog' : 'Add Iceberg Catalog'}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                Connect to an Apache Iceberg REST Catalog
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
                placeholder="My Iceberg Catalog"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">REST Catalog URL</FormLabel>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:8181"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                The URL of the Iceberg REST catalog server
              </FormHelperText>
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Prefix (optional)</FormLabel>
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="default"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                Catalog prefix for multi-tenant setups
              </FormHelperText>
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">S3 Endpoint (optional)</FormLabel>
              <Input
                value={s3Endpoint}
                onChange={(e) => setS3Endpoint(e.target.value)}
                placeholder="http://localhost:9000"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                For MinIO or S3-compatible storage
              </FormHelperText>
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Access Key (optional)</FormLabel>
              <Input
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Secret Key (optional)</FormLabel>
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
            </FormControl>

            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Jupyter/Sedona URL (optional)</FormLabel>
              <Input
                value={jupyterUrl}
                onChange={(e) => setJupyterUrl(e.target.value)}
                placeholder="http://localhost:8888"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                URL for Jupyter notebook with Apache Sedona for data exploration and uploads
              </FormHelperText>
            </FormControl>

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
                      {testResult.success && testResult.namespaceCount !== undefined && (
                        <Text fontSize="xs" color="gray.600">
                          Found {testResult.namespaceCount} namespace{testResult.namespaceCount !== 1 ? 's' : ''}
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
              colorScheme="cyan"
              onClick={handleSubmit}
              isLoading={isLoading}
              borderRadius="lg"
              px={6}
              leftIcon={<FiServer />}
            >
              {isEditMode ? 'Save Changes' : 'Add Connection'}
            </Button>
          </motion.div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

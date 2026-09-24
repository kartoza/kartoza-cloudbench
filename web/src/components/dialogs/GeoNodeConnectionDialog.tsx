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
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  FormHelperText,
} from '@chakra-ui/react'
import { FiEye, FiEyeOff, FiCheck, FiServer } from 'react-icons/fi'
import { TbWorld } from 'react-icons/tb'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import { springs } from '../../utils/animations'
import { getCreateGeoNodeUrl } from '../../config/env'
import { BuyExternallyOption } from './BuyExternallyOption'

export default function GeoNodeConnectionDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Form fields
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [authMethod, setAuthMethod] = useState(0) // 0 = Basic, 1 = Token
  const [showPassword, setShowPassword] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)

  const isOpen = activeDialog === 'geonode'
  const isEditMode = dialogData?.mode === 'edit'
  const connectionId = dialogData?.data?.connectionId as string | undefined
  const createGeoNodeUrl = getCreateGeoNodeUrl()

  // Load existing data in edit mode
  useEffect(() => {
    if (isOpen && isEditMode && connectionId) {
      // Fetch existing connection data
      api.getGeoNodeConnection(connectionId).then((conn) => {
        setName(conn.name)
        setUrl(conn.url)
        setUsername(conn.username || '')
        setPassword('') // Don't show existing password
        setToken('') // Don't show existing token
        setAuthMethod(conn.has_token ? 1 : 0)
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
      setUrl('')
      setUsername('')
      setPassword('')
      setToken('')
      setAuthMethod(0)
      setShowPassword(false)
      setShowToken(false)
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
          description: 'Please enter a GeoNode URL first',
          status: 'warning',
          duration: 3000,
        })
        setIsTesting(false)
        return
      }

      const result = await api.testGeoNodeConnectionDirect({
        name: name || 'Test',
        url,
        username: authMethod === 0 ? username : undefined,
        password: authMethod === 0 ? password : undefined,
        token: authMethod === 1 ? token : undefined,
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message })
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
        username: authMethod === 0 ? username : undefined,
        password: authMethod === 0 ? password : undefined,
        token: authMethod === 1 ? token : undefined,
      }

      if (isEditMode && connectionId) {
        await api.updateGeoNodeConnection(connectionId, connectionData)
        toast({
          title: 'Connection updated',
          status: 'success',
          duration: 2000,
        })
      } else {
        await api.createGeoNodeConnection(connectionData)
        toast({
          title: 'Connection added',
          status: 'success',
          duration: 2000,
        })
      }

      // Refresh GeoNode connections list
      queryClient.invalidateQueries({ queryKey: ['geonodeconnections'] })
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
              <Icon as={TbWorld} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {isEditMode ? 'Edit GeoNode Connection' : 'Add GeoNode Connection'}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                Connect to a GeoNode instance to browse resources
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={4}>
            {!isEditMode && (
              <BuyExternallyOption
                url={createGeoNodeUrl}
                label="Buy in GeoHosting"
                onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ['geonodeconnections'] })
                  closeDialog()
                }}
              />
            )}

            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Connection Name</FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My GeoNode Server"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">GeoNode URL</FormLabel>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://geonode.example.com"
                size="lg"
                borderRadius="lg"
              />
              <FormHelperText>
                Base URL of the GeoNode instance (without trailing slash)
              </FormHelperText>
            </FormControl>

            <Tabs
              variant="soft-rounded"
              colorScheme="teal"
              index={authMethod}
              onChange={setAuthMethod}
              w="100%"
            >
              <TabList mb={3}>
                <Tab>Basic Auth</Tab>
                <Tab>API Token</Tab>
              </TabList>
              <TabPanels>
                <TabPanel p={0}>
                  <VStack spacing={4}>
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
                          placeholder={isEditMode ? '(unchanged)' : 'Enter password'}
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
                  </VStack>
                </TabPanel>
                <TabPanel p={0}>
                  <FormControl>
                    <FormLabel fontWeight="500" color="gray.700">API Token</FormLabel>
                    <InputGroup size="lg">
                      <Input
                        type={showToken ? 'text' : 'password'}
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder={isEditMode ? '(unchanged)' : 'Enter API token'}
                        borderRadius="lg"
                      />
                      <InputRightElement h="full">
                        <IconButton
                          aria-label={showToken ? 'Hide token' : 'Show token'}
                          icon={showToken ? <FiEyeOff /> : <FiEye />}
                          variant="ghost"
                          size="md"
                          onClick={() => setShowToken(!showToken)}
                        />
                      </InputRightElement>
                    </InputGroup>
                    <FormHelperText>
                      Get your API token from GeoNode profile settings
                    </FormHelperText>
                  </FormControl>
                </TabPanel>
              </TabPanels>
            </Tabs>

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
                      <Text fontSize="sm">
                        {testResult.success ? 'Connection successful!' : testResult.error || 'Connection failed'}
                      </Text>
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
              colorScheme="teal"
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

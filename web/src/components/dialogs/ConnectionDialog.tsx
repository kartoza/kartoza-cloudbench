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
  Select,
  Divider,
} from '@chakra-ui/react'
import { FiEye, FiEyeOff, FiServer, FiCheck, FiDatabase } from 'react-icons/fi'
import { useUIStore } from '../../stores/uiStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { createPGService, testPGService, type PGServiceCreate } from '../../api/client'
import { springs } from '../../utils/animations'

type ConnectionType = 'geoserver' | 'postgresql'

// Animation variants for form transitions
const formVariants = {
  hidden: { opacity: 0, x: 20, height: 0 },
  visible: {
    opacity: 1,
    x: 0,
    height: 'auto',
    transition: { ...springs.snappy, staggerChildren: 0.05 }
  },
  exit: { opacity: 0, x: -20, height: 0, transition: { duration: 0.2 } }
}

const fieldVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: springs.snappy },
  exit: { opacity: 0, y: -10, transition: { duration: 0.1 } }
}

export default function ConnectionDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)

  const addConnection = useConnectionStore((state) => state.addConnection)
  const updateConnection = useConnectionStore((state) => state.updateConnection)
  const testConnection = useConnectionStore((state) => state.testConnection)
  const connections = useConnectionStore((state) => state.connections)
  const refreshPGServices = useConnectionStore((state) => state.refreshPGServices)

  // Connection type selector
  const [connectionType, setConnectionType] = useState<ConnectionType>('geoserver')

  // GeoServer fields
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // PostgreSQL fields
  const [pgName, setPgName] = useState('')
  const [pgHost, setPgHost] = useState('localhost')
  const [pgPort, setPgPort] = useState('5432')
  const [pgDatabase, setPgDatabase] = useState('')
  const [pgUser, setPgUser] = useState('')
  const [pgPassword, setPgPassword] = useState('')
  const [pgSSLMode, setPgSSLMode] = useState('prefer')
  const [showPgPassword, setShowPgPassword] = useState(false)

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
        setConnectionType('geoserver')
        setName(conn.name)
        setUrl(conn.url)
        setUsername(conn.username)
        setPassword(conn.password || '')
        setShowPassword(false)
      }
    } else if (isOpen && !isEditMode) {
      // Reset all fields for new connection
      setConnectionType('geoserver')
      setName('')
      setUrl('')
      setUsername('')
      setPassword('')
      setShowPassword(false)
      setPgName('')
      setPgHost('localhost')
      setPgPort('5432')
      setPgDatabase('')
      setPgUser('')
      setPgPassword('')
      setPgSSLMode('prefer')
      setShowPgPassword(false)
    }
    setTestResult(null)
  }, [isOpen, isEditMode, connectionId, connections])

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)

    try {
      if (connectionType === 'geoserver') {
        if (!connectionId && !url) {
          toast({
            title: 'URL required',
            description: 'Please enter a GeoServer URL first',
            status: 'warning',
            duration: 3000,
          })
          setIsTesting(false)
          return
        }

        if (!connectionId) {
          // Create temp connection
          const tempConn = await addConnection({ name: name || 'Test', url, username, password })
          const result = await testConnection(tempConn.id)
          if (!result.success) {
            await useConnectionStore.getState().removeConnection(tempConn.id)
          }
          setTestResult(result)
        } else {
          const result = await testConnection(connectionId)
          setTestResult(result)
        }
      } else {
        // PostgreSQL test - need to create first then test
        if (!pgName) {
          toast({
            title: 'Service name required',
            description: 'Please enter a service name first',
            status: 'warning',
            duration: 3000,
          })
          setIsTesting(false)
          return
        }

        // Create the service first
        const pgService: PGServiceCreate = {
          name: pgName,
          host: pgHost,
          port: pgPort,
          dbname: pgDatabase,
          user: pgUser,
          password: pgPassword,
          sslmode: pgSSLMode,
        }
        await createPGService(pgService)

        // Now test
        const result = await testPGService(pgName)
        setTestResult(result)
      }
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSubmit = async () => {
    setIsLoading(true)

    try {
      if (connectionType === 'geoserver') {
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
      } else {
        // PostgreSQL - save to pg_service.conf
        if (!pgName || !pgHost || !pgDatabase) {
          toast({
            title: 'Required fields',
            description: 'Service name, host, and database are required',
            status: 'warning',
            duration: 3000,
          })
          setIsLoading(false)
          return
        }

        const pgService: PGServiceCreate = {
          name: pgName,
          host: pgHost,
          port: pgPort,
          dbname: pgDatabase,
          user: pgUser,
          password: pgPassword,
          sslmode: pgSSLMode,
        }

        await createPGService(pgService)
        await refreshPGServices?.()

        toast({
          title: 'PostgreSQL service added',
          description: `Service "${pgName}" saved to pg_service.conf`,
          status: 'success',
          duration: 3000,
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

  const getHeaderGradient = () => {
    return connectionType === 'geoserver'
      ? 'linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 100%)'
      : 'linear-gradient(135deg, #336791 0%, #5B93C5 100%)'
  }

  const getHeaderIcon = () => {
    return connectionType === 'geoserver' ? FiServer : FiDatabase
  }

  const getHeaderTitle = () => {
    if (isEditMode) return 'Edit Connection'
    return connectionType === 'geoserver' ? 'Add GeoServer' : 'Add PostgreSQL'
  }

  const getHeaderSubtitle = () => {
    if (isEditMode) return 'Update your connection settings'
    return connectionType === 'geoserver'
      ? 'Connect to a GeoServer instance'
      : 'Add a PostgreSQL service to pg_service.conf'
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        {/* Animated Gradient Header */}
        <motion.div
          animate={{ background: getHeaderGradient() }}
          transition={{ duration: 0.3 }}
          style={{ padding: '16px 24px' }}
        >
          <HStack spacing={3}>
            <motion.div
              key={connectionType}
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={springs.bouncy}
            >
              <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
                <Icon as={getHeaderIcon()} boxSize={5} color="white" />
              </Box>
            </motion.div>
            <Box>
              <motion.div
                key={`title-${connectionType}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springs.snappy}
              >
                <Text color="white" fontWeight="600" fontSize="lg">
                  {getHeaderTitle()}
                </Text>
              </motion.div>
              <motion.div
                key={`subtitle-${connectionType}`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.snappy, delay: 0.1 }}
              >
                <Text color="whiteAlpha.800" fontSize="sm">
                  {getHeaderSubtitle()}
                </Text>
              </motion.div>
            </Box>
          </HStack>
        </motion.div>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={4}>
            {/* Connection Type Selector - only show for new connections */}
            {!isEditMode && (
              <FormControl>
                <FormLabel fontWeight="500" color="gray.700">Connection Type</FormLabel>
                <HStack spacing={3}>
                  <motion.div style={{ flex: 1 }} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Box
                      as="button"
                      type="button"
                      onClick={() => setConnectionType('geoserver')}
                      w="100%"
                      p={4}
                      borderRadius="lg"
                      border="2px solid"
                      borderColor={connectionType === 'geoserver' ? 'blue.500' : 'gray.200'}
                      bg={connectionType === 'geoserver' ? 'blue.50' : 'white'}
                      transition="all 0.2s"
                      _hover={{ borderColor: 'blue.300' }}
                    >
                      <VStack spacing={1}>
                        <Icon as={FiServer} boxSize={6} color={connectionType === 'geoserver' ? 'blue.500' : 'gray.400'} />
                        <Text fontWeight="500" color={connectionType === 'geoserver' ? 'blue.700' : 'gray.600'}>
                          GeoServer
                        </Text>
                        <Text fontSize="xs" color="gray.500">Web map server</Text>
                      </VStack>
                    </Box>
                  </motion.div>
                  <motion.div style={{ flex: 1 }} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Box
                      as="button"
                      type="button"
                      onClick={() => setConnectionType('postgresql')}
                      w="100%"
                      p={4}
                      borderRadius="lg"
                      border="2px solid"
                      borderColor={connectionType === 'postgresql' ? 'blue.500' : 'gray.200'}
                      bg={connectionType === 'postgresql' ? 'blue.50' : 'white'}
                      transition="all 0.2s"
                      _hover={{ borderColor: 'blue.300' }}
                    >
                      <VStack spacing={1}>
                        <Icon as={FiDatabase} boxSize={6} color={connectionType === 'postgresql' ? 'blue.500' : 'gray.400'} />
                        <Text fontWeight="500" color={connectionType === 'postgresql' ? 'blue.700' : 'gray.600'}>
                          PostgreSQL
                        </Text>
                        <Text fontSize="xs" color="gray.500">Database service</Text>
                      </VStack>
                    </Box>
                  </motion.div>
                </HStack>
              </FormControl>
            )}

            <Divider />

            {/* GeoServer Form */}
            <AnimatePresence mode="wait">
              {connectionType === 'geoserver' && (
                <motion.div
                  key="geoserver-form"
                  variants={formVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  style={{ width: '100%' }}
                >
                  <VStack spacing={4} w="100%">
                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
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
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
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
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
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
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
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
                    </motion.div>
                  </VStack>
                </motion.div>
              )}

              {/* PostgreSQL Form */}
              {connectionType === 'postgresql' && (
                <motion.div
                  key="postgresql-form"
                  variants={formVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  style={{ width: '100%' }}
                >
                  <VStack spacing={4} w="100%">
                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
                      <FormControl isRequired>
                        <FormLabel fontWeight="500" color="gray.700">Service Name</FormLabel>
                        <Input
                          value={pgName}
                          onChange={(e) => setPgName(e.target.value)}
                          placeholder="my_database"
                          size="lg"
                          borderRadius="lg"
                        />
                        <Text fontSize="xs" color="gray.500" mt={1}>
                          This will be saved to ~/.pg_service.conf
                        </Text>
                      </FormControl>
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
                      <HStack spacing={4}>
                        <FormControl isRequired flex={2}>
                          <FormLabel fontWeight="500" color="gray.700">Host</FormLabel>
                          <Input
                            value={pgHost}
                            onChange={(e) => setPgHost(e.target.value)}
                            placeholder="localhost"
                            size="lg"
                            borderRadius="lg"
                          />
                        </FormControl>
                        <FormControl flex={1}>
                          <FormLabel fontWeight="500" color="gray.700">Port</FormLabel>
                          <Input
                            value={pgPort}
                            onChange={(e) => setPgPort(e.target.value)}
                            placeholder="5432"
                            size="lg"
                            borderRadius="lg"
                          />
                        </FormControl>
                      </HStack>
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
                      <FormControl isRequired>
                        <FormLabel fontWeight="500" color="gray.700">Database</FormLabel>
                        <Input
                          value={pgDatabase}
                          onChange={(e) => setPgDatabase(e.target.value)}
                          placeholder="postgres"
                          size="lg"
                          borderRadius="lg"
                        />
                      </FormControl>
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
                      <FormControl>
                        <FormLabel fontWeight="500" color="gray.700">Username</FormLabel>
                        <Input
                          value={pgUser}
                          onChange={(e) => setPgUser(e.target.value)}
                          placeholder="postgres"
                          size="lg"
                          borderRadius="lg"
                        />
                      </FormControl>
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
                      <FormControl>
                        <FormLabel fontWeight="500" color="gray.700">Password</FormLabel>
                        <InputGroup size="lg">
                          <Input
                            type={showPgPassword ? 'text' : 'password'}
                            value={pgPassword}
                            onChange={(e) => setPgPassword(e.target.value)}
                            placeholder="password"
                            borderRadius="lg"
                          />
                          <InputRightElement h="full">
                            <IconButton
                              aria-label={showPgPassword ? 'Hide password' : 'Show password'}
                              icon={showPgPassword ? <FiEyeOff /> : <FiEye />}
                              variant="ghost"
                              size="md"
                              onClick={() => setShowPgPassword(!showPgPassword)}
                            />
                          </InputRightElement>
                        </InputGroup>
                      </FormControl>
                    </motion.div>

                    <motion.div variants={fieldVariants} style={{ width: '100%' }}>
                      <FormControl>
                        <FormLabel fontWeight="500" color="gray.700">SSL Mode</FormLabel>
                        <Select
                          value={pgSSLMode}
                          onChange={(e) => setPgSSLMode(e.target.value)}
                          size="lg"
                          borderRadius="lg"
                        >
                          <option value="disable">disable</option>
                          <option value="allow">allow</option>
                          <option value="prefer">prefer</option>
                          <option value="require">require</option>
                          <option value="verify-ca">verify-ca</option>
                          <option value="verify-full">verify-full</option>
                        </Select>
                      </FormControl>
                    </motion.div>
                  </VStack>
                </motion.div>
              )}
            </AnimatePresence>

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
                    <Text fontSize="sm">{testResult.message}</Text>
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
              colorScheme={connectionType === 'geoserver' ? 'blue' : 'purple'}
              onClick={handleSubmit}
              isLoading={isLoading}
              borderRadius="lg"
              px={6}
            >
              {isEditMode ? 'Save Changes' : 'Add Connection'}
            </Button>
          </motion.div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

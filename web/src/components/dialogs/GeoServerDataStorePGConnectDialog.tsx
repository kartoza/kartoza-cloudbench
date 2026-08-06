import { type ChangeEvent, useEffect, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  Select,
  Spinner,
  Switch,
  Text,
  VStack,
} from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FiDatabase, FiServer } from 'react-icons/fi'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'

export default function GeoServerDataStorePGConnectDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()

  const isOpen = activeDialog === 'pgconnect'
  const connectionId = (dialogData?.data?.connectionId as string) ?? ''
  const workspace = (dialogData?.data?.workspace as string) ?? ''

  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [database, setDatabase] = useState('')
  const [schema, setSchema] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['pgservices'],
    queryFn: () => api.getPGServices(),
    enabled: isOpen,
  })

  const { data: databases = [], isLoading: dbLoading } = useQuery({
    queryKey: ['pg-database-names', selected],
    queryFn: () => api.getPGDatabaseNames(selected!),
    enabled: !!selected,
  })

  const { data: schemas = [], isLoading: schemaLoading } = useQuery({
    queryKey: ['pg-schema-names', selected, database],
    queryFn: () => api.getPGSchemaNames(selected!, database),
    enabled: !!selected && !!database,
  })

  useEffect(() => {
    if (databases.length > 0 && !database) {
      setDatabase(databases[0])
    }
  }, [databases])

  useEffect(() => {
    if (schemas.length === 0) return
    setSchema(schemas.includes('public') ? 'public' : schemas[0])
  }, [schemas])

  const mutation = useMutation({
    mutationFn: () => api.connectDataStoreToPG(connectionId, workspace, selected!, {
      name: name.trim() || undefined,
      database: database || undefined,
      schema: schema || undefined,
      description,
      enabled,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['datastores', connectionId, workspace] })
      closeDialog()
    },
  })

  const handleSelectService = (svc: typeof services[number]) => {
    setSelected(svc.name)
    setName(svc.name)
    setDatabase('')
    setSchema('')
  }

  const handleSelectDatabase = (db: string) => {
    setDatabase(db)
    setSchema('')
  }

  if (!isOpen) return null

  const renderBody = () => {
    if (isLoading) {
      return (
        <VStack py={10}>
          <Spinner size="xl" color="kartoza.500" />
          <Text color="gray.500">Loading PostgreSQL connections...</Text>
        </VStack>
      )
    }

    if (services.length === 0) {
      return (
        <VStack py={10}>
          <Icon as={FiDatabase} boxSize={10} color="gray.300" />
          <Text color="gray.500">No PostgreSQL connections found.</Text>
          <Text fontSize="sm" color="gray.400">Add a connection in the PostgreSQL dashboard first.</Text>
        </VStack>
      )
    }

    return (
      <VStack spacing={4} align="stretch">
        <Text fontSize="sm" color="gray.500">
          Select a PostgreSQL connection to create a PostGIS data store in workspace <b>{workspace}</b>.
        </Text>

        <VStack spacing={2} align="stretch">
          {services.map((svc) => {
            const isSelected = selected === svc.name
            return (
              <Box
                key={svc.name}
                p={3}
                borderRadius="lg"
                border="2px solid"
                borderColor={isSelected ? 'kartoza.500' : 'gray.200'}
                bg={isSelected ? 'kartoza.50' : 'white'}
                cursor="pointer"
                onClick={() => handleSelectService(svc)}
                _hover={{ borderColor: 'kartoza.300', bg: 'gray.50' }}
                transition="all 0.15s"
              >
                <HStack justify="space-between">
                  <HStack spacing={3}>
                    <Icon as={FiServer} color={isSelected ? 'kartoza.500' : 'gray.400'} boxSize={5} />
                    <VStack align="start" spacing={0}>
                      <Text fontWeight="semibold" fontSize="sm">{svc.name}</Text>
                      <Text fontSize="xs" color="gray.500">
                        {svc.host}:{svc.port ?? '5432'} / {svc.dbname ?? '—'}
                      </Text>
                    </VStack>
                  </HStack>
                  <HStack>
                    {svc.online === true && <Badge colorScheme="green" fontSize="xs">Online</Badge>}
                    {svc.online === false && <Badge colorScheme="red" fontSize="xs">Offline</Badge>}
                  </HStack>
                </HStack>
              </Box>
            )
          })}
        </VStack>

        {selected && (
          <>
            <FormControl isRequired>
              <FormLabel>Store Name</FormLabel>
              <Input
                value={name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                placeholder={selected}
              />
            </FormControl>

            <FormControl isRequired>
              <FormLabel>Database</FormLabel>
              <Select
                placeholder={dbLoading ? 'Loading...' : 'Select database'}
                value={database}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleSelectDatabase(e.target.value)}
                isDisabled={dbLoading}
              >
                {databases.map((db) => (
                  <option key={db} value={db}>{db}</option>
                ))}
              </Select>
            </FormControl>

            <FormControl isRequired>
              <FormLabel>Schema</FormLabel>
              <Select
                placeholder={schemaLoading ? 'Loading...' : 'Select schema'}
                value={schema}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setSchema(e.target.value)}
                isDisabled={!database || schemaLoading}
              >
                {schemas.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </FormControl>

            <FormControl>
              <FormLabel>Description</FormLabel>
              <Input
                value={description}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </FormControl>

            <FormControl>
              <HStack justify="space-between">
                <FormLabel mb={0}>Enabled</FormLabel>
                <Switch
                  isChecked={enabled}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)}
                  colorScheme="kartoza"
                />
              </HStack>
            </FormControl>
          </>
        )}

        {mutation.isError && (
          <Text color="red.500" fontSize="sm">
            {(mutation.error as Error).message}
          </Text>
        )}

        <Button
          colorScheme="kartoza"
          isDisabled={!selected || !database || !schema}
          isLoading={mutation.isPending}
          loadingText="Connecting..."
          onClick={() => mutation.mutate()}
        >
          Connect
        </Button>
      </VStack>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        <Box
          bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiDatabase} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Connect to PostgreSQL
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">{workspace}</Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          {renderBody()}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
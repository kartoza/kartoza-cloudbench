import { type ChangeEvent, type FormEvent, type RefObject, useEffect, useState } from 'react'
import {
  Box,
  Button,
  ButtonGroup,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  Input,
  Spinner,
  Switch,
  Text,
  useToast,
  VStack,
} from '@chakra-ui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FiDatabase } from 'react-icons/fi'
import * as api from '../../../../api'
import { PGEditorMode, PGEditorModeType } from '../types.ts'
import { useUIStore } from '../../../../stores/uiStore'
import DataStorePostGIS, { type PostGISFormData } from './DataStorePostGIS.tsx'
import { entriesToObject } from '../utils.ts'

export interface Props {
  connectionId: string;
  workspace: string;
  storeName?: string;
  mode: PGEditorModeType
  formRef?: RefObject<HTMLFormElement>
  onPendingChange?: (isPending: boolean) => void
}

export interface FormData {
  name: string
  description: string
  enabled: boolean
}

const STORE_TYPES = [
  { key: 'postgis', label: 'PostGIS', icon: FiDatabase },
] as const

type StoreTypeKey = typeof STORE_TYPES[number]['key']

export default function GeoServerDataStoreEditor(
  { connectionId, workspace, storeName, mode, formRef, onPendingChange }: Props
) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const closeDialog = useUIStore((state) => state.closeDialog)

  const [storeType, setStoreType] = useState<StoreTypeKey>('postgis')
  const [form, setForm] = useState<FormData>({} as FormData)
  const [connectionParametersForm, setConnectionParametersForm] = useState<PostGISFormData>({} as PostGISFormData)

  const isCreateMode = mode === PGEditorMode.CREATE
  const isEditMode = mode === PGEditorMode.EDIT
  const isOpen = isCreateMode || isEditMode

  const { data, isLoading } = useQuery({
    queryKey: ['datastores', connectionId, workspace, storeName],
    queryFn: () => api.getDataStore(connectionId, workspace, storeName!),
    enabled: isEditMode && !!connectionId && !!workspace && !!storeName,
  })
  const store = data

  useEffect(() => {
    if (!store) return
    setForm({
      name: store.name,
      description: store.description,
      enabled: store.enabled,
    })
    const params = entriesToObject(store.connectionParameters)
    setStoreType((params.dbtype as StoreTypeKey) ?? 'postgis')
    setConnectionParametersForm(params as unknown as PostGISFormData)
  }, [store])

  const mutation = useMutation({
    mutationFn: () =>
      api.createDataStore(connectionId, workspace, {
        ...form,
        connectionParameters: connectionParametersForm as unknown as Record<string, string>
      }),
    onSuccess: () => {
      toast({
        title: 'Data store created',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      void queryClient.invalidateQueries({ queryKey: ['datastores', connectionId, workspace] })
      closeDialog()
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to create data store',
        description: err.message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
    },
  })

  useEffect(() => {
    onPendingChange?.(mutation.isPending)
  }, [mutation.isPending])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  if (!isOpen) return null

  // Edit mode — show store details
  if (isEditMode) {
    if (isLoading) {
      return (
        <VStack py={10}>
          <Spinner size="xl" color="kartoza.500"/>
          <Text color="gray.500">Loading store details...</Text>
        </VStack>
      )
    }

    if (!store) {
      return (
        <VStack py={10}>
          <Text color="gray.500">Store not found</Text>
        </VStack>
      )
    }

    if (!form.name) {
      return (
        <VStack py={10}>
          <Text color="gray.500">
            Configuration is not correct.
            Please edit it on geoserver admin page.
          </Text>
        </VStack>
      )
    }
  }

  return (
    <Box as="form" ref={formRef as unknown as RefObject<HTMLDivElement>} onSubmit={handleSubmit}>
      <VStack spacing={6} align="stretch">
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="gray.600" mb={2}>
            Select Store Type
          </Text>
          <ButtonGroup isAttached w="100%" size="sm">
            {STORE_TYPES.map(({ key, label, icon }) => (
              <Button
                key={key}
                flex="1"
                leftIcon={<Icon as={icon}/>}
                colorScheme={storeType === key ? 'kartoza' : 'gray'}
                variant={storeType === key ? 'solid' : 'outline'}
                onClick={() => setStoreType(key)}
              >
                {label}
              </Button>
            ))}
          </ButtonGroup>
        </Box>

        <VStack spacing={4} align="stretch">
          <FormControl isRequired>
            <FormLabel>Store Name</FormLabel>
            <Input
              value={form.name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm(prev => ({
                ...prev,
                name: e.target.value
              }))}
              placeholder="Store name"
            />
          </FormControl>

          <FormControl>
            <FormLabel>Description</FormLabel>
            <Input
              value={form.description}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm(prev => ({
                ...prev,
                description: e.target.value
              }))}
              placeholder="Optional description"
            />
          </FormControl>

          <FormControl>
            <HStack justify="space-between">
              <FormLabel mb={0}>Enabled</FormLabel>
              <Switch
                isChecked={form.enabled}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm(prev => ({
                  ...prev,
                  enabled: e.target.checked
                }))}
                colorScheme="kartoza"
              />
            </HStack>
          </FormControl>

          <Text
            fontWeight="semibold" color="gray.600" fontSize="sm"
            pt={2}>
            Connection Parameters
          </Text>
          {storeType === 'postgis' && (
            <DataStorePostGIS
              form={connectionParametersForm}
              setForm={setConnectionParametersForm}
              mode={mode}
            />
          )}
        </VStack>
      </VStack>
    </Box>
  )
}
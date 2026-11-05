import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalOverlay,
  Progress,
  Radio,
  RadioGroup,
  Select,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Spinner,
  Switch,
  Text,
  Tooltip,
  VStack,
  useToast,
} from '@chakra-ui/react'
import {
  FiAlertCircle,
  FiCheckCircle,
  FiChevronRight,
  FiCircle,
  FiFolder,
  FiLayers,
  FiMinusCircle,
  FiRefreshCw,
  FiXCircle,
} from 'react-icons/fi'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import { getS3Connections } from '../../api/s3'
import { getConversionToolStatus } from '../../api/client'
import type { S3Connection } from '../../types'
import {
  BULK_BATCHES_QUERY_KEY,
  cancelBulk,
  getBulk,
  isActiveBatch,
  listBulkFolders,
  previewBulk,
  restartBulk,
  retryBulk,
  startBulk,
  type BulkBatch,
  type BulkJob,
  type BulkDestination,
  type BulkOptions,
  type OnExists,
} from '../../api/bulk'
import {
  KIND_COLORS,
  KIND_LABELS,
  batchCounts,
  batchProgress,
  batchSummary,
  formatSize,
  serversSummary,
} from '../../utils/bulkBatch'

// Mirrors apps.s3.portolan.LICENSE_CHOICES, as the Upload dialog does.
const LICENSE_CHOICES = [
  { id: 'other', label: 'Other / not specified' },
  { id: 'CC0-1.0', label: 'CC0 1.0 (Public Domain)' },
  { id: 'CC-BY-4.0', label: 'CC BY 4.0' },
  { id: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0' },
  { id: 'ODbL-1.0', label: 'ODbL 1.0' },
]

// A folder as a key prefix: no leading slash, one trailing slash, "" for the bucket.
function folderPrefix(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '')
  return trimmed ? `${trimmed}/` : ''
}

type Step = 'folder' | 'review' | 'progress'

const STEP_TITLES: Record<Step, string> = {
  folder: '1 of 3 · Choose a folder',
  review: '2 of 3 · Review and options',
  progress: '3 of 3 · Progress',
}

function JobStatusIcon({ job }: { job: BulkJob }) {
  switch (job.status) {
    case 'completed':
      return <Icon as={FiCheckCircle} color="green.500" />
    case 'failed':
      return <Icon as={FiAlertCircle} color="red.500" />
    case 'cancelled':
      return <Icon as={FiXCircle} color="gray.400" />
    case 'skipped':
      return <Icon as={FiMinusCircle} color="gray.400" />
    case 'running':
      return <Icon as={FiRefreshCw} className="spin" color="blue.500" />
    default:
      return <Icon as={FiCircle} color="gray.300" />
  }
}

// The name of the connection `id`, to say where layers come from and go to.
function connectionName(connections: S3Connection[], id: string): string {
  return connections.find((connection) => connection.id === id)?.name ?? 'this bucket'
}

// Step 1: pick a bucket (one of the user's connections) and browse its folders; the one you're in is converted.
function FolderStep({
  connections,
  connectionId,
  sourceId,
  onSource,
  browsing,
  onBrowse,
  onNext,
  onClose,
}: {
  connections: S3Connection[]
  // The connection the layers go to, and the one whose folders are browsed.
  connectionId: string
  sourceId: string
  onSource: (id: string) => void
  browsing: string
  onBrowse: (prefix: string) => void
  onNext: () => void
  onClose: () => void
}) {
  const { data: folders = [], isLoading } = useQuery({
    queryKey: ['bulkFolders', sourceId, browsing],
    queryFn: () => listBulkFolders(sourceId, browsing),
  })
  const crumbs = browsing.split('/').filter(Boolean)

  return (
    <>
      <ModalBody py={4}>
        <VStack align="stretch" spacing={3}>
          <Text fontSize="sm" color="gray.600">
            Pick the folder the layers were uploaded to. Every layer CloudBench can convert in it is processed; you
            review the list next.
          </Text>
          {connections.length > 1 && (
            <FormControl>
              <FormLabel fontSize="sm">Read the layers from</FormLabel>
              <Select
                size="sm"
                value={sourceId}
                onChange={(e) => onSource(e.target.value)}
                borderRadius="lg"
                aria-label="Read the layers from"
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ({connection.bucket})
                  </option>
                ))}
              </Select>
              <Text fontSize="xs" color="gray.500" mt={1}>
                {sourceId === connectionId
                  ? `The layers are published into ${connectionName(connections, connectionId)}, the bucket you opened this from.`
                  : `The files are read from ${connectionName(connections, sourceId)}, where they are, and the layers published into ${connectionName(connections, connectionId)}.`}
              </Text>
            </FormControl>
          )}
          <HStack spacing={1} fontSize="sm" wrap="wrap" data-testid="bulk-breadcrumb">
            <Button size="xs" variant="link" onClick={() => onBrowse('')}>
              bucket
            </Button>
            {crumbs.map((crumb, index) => (
              <HStack key={crumb + index} spacing={1}>
                <Text color="gray.400">/</Text>
                <Button size="xs" variant="link" onClick={() => onBrowse(`${crumbs.slice(0, index + 1).join('/')}/`)}>
                  {crumb}
                </Button>
              </HStack>
            ))}
          </HStack>
          <Box border="1px solid" borderColor="gray.200" borderRadius="lg" minH="180px">
            {isLoading && (
              <Center py={10}>
                <Spinner size="sm" />
              </Center>
            )}
            {!isLoading && folders.length === 0 && (
              <Text fontSize="sm" color="gray.500" p={4}>
                No subfolders. Use Next to review the layers in this folder.
              </Text>
            )}
            {folders.map((folder) => (
              <HStack
                key={folder.prefix}
                as="button"
                type="button"
                w="100%"
                px={3}
                py={2.5}
                justify="space-between"
                borderBottom="1px solid"
                borderColor="gray.100"
                _last={{ borderBottom: 'none' }}
                _hover={{ bg: 'gray.50' }}
                onClick={() => onBrowse(folder.prefix)}
                aria-label={`Open ${folder.name}`}
              >
                <HStack spacing={3}>
                  <Icon as={FiFolder} color="orange.400" />
                  <Text fontSize="sm" fontWeight="500">
                    {folder.name}
                  </Text>
                </HStack>
                <Icon as={FiChevronRight} color="gray.400" />
              </HStack>
            ))}
          </Box>
        </VStack>
      </ModalBody>
      <ModalFooter borderTop="1px solid" borderColor="gray.100" gap={2}>
        <Button variant="ghost" onClick={onClose} borderRadius="lg">
          Cancel
        </Button>
        <Button colorScheme="orange" borderRadius="lg" isDisabled={browsing === ''} onClick={onNext}>
          Next
        </Button>
      </ModalFooter>
    </>
  )
}

// Step 2: what was found, and how to process it.
function ReviewStep({
  connections,
  connectionId,
  sourceId,
  prefix,
  onStart,
  isStarting,
  onBack,
  onClose,
}: {
  connections: S3Connection[]
  connectionId: string
  sourceId: string
  prefix: string
  onStart: (options: BulkOptions) => void
  isStarting: boolean
  onBack: () => void
  onClose: () => void
}) {
  // The destination folder decides which layers already exist, so the folder is
  // read again with it - once it's typed (on blur), not on every key.
  const [applied, setApplied] = useState<{ mode: BulkDestination; prefix: string }>({ mode: 'root', prefix: '' })
  const {
    data: preview,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['bulkPreview', connectionId, sourceId, prefix, applied.mode, applied.prefix],
    queryFn: () => previewBulk(connectionId, prefix, applied.mode, applied.prefix, sourceId),
    placeholderData: keepPreviousData,
  })
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [license, setLicense] = useState(LICENSE_CHOICES[0].id)
  const [licenseUrl, setLicenseUrl] = useState('')
  // Like the layers of other uploads: at the top of the bucket.
  const [destination, setDestination] = useState<BulkDestination>('root')
  const [destinationPrefix, setDestinationPrefix] = useState('')
  const [onExists, setOnExists] = useState<OnExists>('skip')
  // A VRT of the GeoTIFFs, named after the folder they are in.
  const [createVrt, setCreateVrt] = useState(true)
  const [vrtName, setVrtName] = useState(`${prefix.split('/').filter(Boolean).pop() ?? 'rasters'}-vrt`)
  const [concurrency, setConcurrency] = useState(2)

  const convertible = useMemo(() => (preview?.files ?? []).filter((file) => file.kind), [preview])
  const skipped = useMemo(() => (preview?.files ?? []).filter((file) => !file.kind), [preview])
  const chosen = selected ?? new Set(convertible.map((file) => file.key))
  const limits = preview?.limits
  const slots = Math.min(concurrency, Math.max(chosen.size, 1))
  // On demand, the servers are started as the type picked here (the cheapest in stock by
  // default; one out of stock is listed but can't be picked), and deleted when not needed
  // unless kept.
  const { data: toolStatus } = useQuery({
    queryKey: ['conversionTools'],
    queryFn: getConversionToolStatus,
    enabled: !!limits?.onDemand,
  })
  const serverTypes = toolStatus?.cloudnativegis?.onDemand ? (toolStatus.cloudnativegis.servers ?? []) : []
  const inStockServers = serverTypes.filter((server) => server.available !== false)
  const [serverTypeId, setServerTypeId] = useState<number>()
  const pickedServerId = inStockServers.some((server) => server.id === serverTypeId)
    ? serverTypeId
    : inStockServers[0]?.id
  const [autoDestroy, setAutoDestroy] = useState(true)
  const acrossBuckets = sourceId !== connectionId
  const sourceName = connectionName(connections, sourceId)

  const toggle = (key: string) => {
    const next = new Set(chosen)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const rasters = convertible.filter((file) => file.kind === 'cog')
  const chosenRasters = rasters.filter((file) => chosen.has(file.key)).length
  const makesVrt = createVrt && chosenRasters >= 2
  const canStart =
    chosen.size > 0 &&
    (destination !== 'folder' || destinationPrefix.trim() !== '') &&
    (!makesVrt || vrtName.trim() !== '') &&
    (!limits?.onDemand || pickedServerId !== undefined)

  const start = () =>
    onStart({
      prefix,
      files: [...chosen],
      license,
      licenseUrl: license === 'other' ? licenseUrl.trim() : '',
      destination,
      destinationPrefix: destinationPrefix.trim(),
      onExists,
      concurrency: slots,
      sourceConnectionId: sourceId,
      createVrt: makesVrt,
      vrtName: makesVrt ? vrtName.trim() : '',
      serverTypeId: limits?.onDemand ? pickedServerId : undefined,
      autoDestroy: limits?.onDemand ? autoDestroy : undefined,
    })

  if (isLoading) {
    return (
      <ModalBody py={4}>
        <Center py={16}>
          <Spinner />
        </Center>
      </ModalBody>
    )
  }
  if (isError || !preview || !limits) {
    return (
      <>
        <ModalBody py={4}>
          <Alert status="error" borderRadius="lg">
            <AlertIcon />
            {error instanceof Error && error.message ? error.message : "Couldn't read that folder."}
          </Alert>
        </ModalBody>
        <ModalFooter borderTop="1px solid" borderColor="gray.100" gap={2}>
          <Button variant="ghost" onClick={onBack} borderRadius="lg">
            Back
          </Button>
        </ModalFooter>
      </>
    )
  }

  return (
    <>
      <ModalBody py={4}>
        <VStack align="stretch" spacing={5}>
          <Box>
            <HStack justify="space-between" mb={2}>
              <Text fontWeight="600" fontSize="sm">
                {acrossBuckets && `${sourceName}: `}
                {prefix} · {convertible.length} layer{convertible.length === 1 ? '' : 's'} found
              </Text>
              <Checkbox
                size="sm"
                isChecked={chosen.size === convertible.length && convertible.length > 0}
                isIndeterminate={chosen.size > 0 && chosen.size < convertible.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(convertible.map((f) => f.key)) : new Set())}
              >
                Select all
              </Checkbox>
            </HStack>
            {preview.truncated && (
              <Text fontSize="xs" color="orange.600" mb={2}>
                This folder holds more files than are listed here: convert the rest in another batch.
              </Text>
            )}
            <Box border="1px solid" borderColor="gray.200" borderRadius="lg" maxH="230px" overflowY="auto">
              {convertible.map((file) => (
                <HStack
                  key={file.key}
                  px={3}
                  py={2}
                  spacing={3}
                  borderBottom="1px solid"
                  borderColor="gray.100"
                  _last={{ borderBottom: 'none' }}
                >
                  <Checkbox
                    isChecked={chosen.has(file.key)}
                    onChange={() => toggle(file.key)}
                    aria-label={`Convert ${file.name}`}
                  />
                  <Text fontSize="sm" flex={1} noOfLines={1}>
                    {file.name}
                  </Text>
                  {file.exists && (
                    <Tooltip label="A layer with this name is already published here: see 'If a layer already exists'">
                      <Badge colorScheme="yellow">Exists</Badge>
                    </Tooltip>
                  )}
                  <Badge colorScheme={KIND_COLORS[file.kind!]} variant="subtle" minW="120px" textAlign="center">
                    {KIND_LABELS[file.kind!]}
                  </Badge>
                  <Text fontSize="xs" color="gray.500" w="64px" textAlign="right">
                    {formatSize(file.size)}
                  </Text>
                </HStack>
              ))}
              {convertible.length === 0 && (
                <Text fontSize="sm" color="gray.500" p={4}>
                  Nothing in this folder can be converted.
                </Text>
              )}
            </Box>
            {skipped.length > 0 && (
              <Box mt={2}>
                <Text fontSize="xs" color="gray.500" mb={1}>
                  Left alone ({skipped.length})
                </Text>
                {skipped.map((file) => (
                  <HStack key={file.key} spacing={2} fontSize="xs" color="gray.500">
                    <Text noOfLines={1} maxW="220px">
                      {file.name}
                    </Text>
                    <Text>- {file.skipReason}</Text>
                  </HStack>
                ))}
              </Box>
            )}
          </Box>

          <HStack align="start" spacing={6}>
            <VStack align="stretch" spacing={4} flex={1}>
              <FormControl>
                <FormLabel fontSize="sm">License</FormLabel>
                <Select size="sm" value={license} onChange={(e) => setLicense(e.target.value)} borderRadius="lg">
                  {LICENSE_CHOICES.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
                {license === 'other' && (
                  <Input
                    mt={2}
                    size="sm"
                    type="url"
                    value={licenseUrl}
                    onChange={(e) => setLicenseUrl(e.target.value)}
                    placeholder="https://example.org/data-license (optional)"
                    borderRadius="lg"
                  />
                )}
              </FormControl>

              <FormControl>
                <FormLabel fontSize="sm">
                  Where the layers go
                  {acrossBuckets && ` in ${connectionName(connections, connectionId)}`}
                </FormLabel>
                <RadioGroup
                  value={destination}
                  onChange={(value) => {
                    setDestination(value as BulkDestination)
                    // A folder is read once it is named (see its field's onBlur).
                    if (value !== 'folder' || destinationPrefix.trim()) {
                      setApplied({
                        mode: value as BulkDestination,
                        prefix: value === 'folder' ? destinationPrefix.trim() : '',
                      })
                    }
                  }}
                >
                  <VStack align="stretch" spacing={2}>
                    {(
                      [
                        [
                          'root',
                          'Top level of the bucket',
                          'Like other layers: each one in a folder at the top, e.g. <name>/',
                        ],
                        [
                          'beside',
                          'Beside each file',
                          acrossBuckets
                            ? `Each layer in a folder at the same path in ${connectionName(connections, connectionId)}, e.g. ${prefix}<name>/`
                            : `Each layer in a folder next to its source file, inside ${prefix}, e.g. ${prefix}<name>/`,
                        ],
                        [
                          'folder',
                          'Into one folder',
                          'Each layer in a folder inside the one you name, e.g. <folder>/<name>/',
                        ],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <Box key={value}>
                        <Radio value={value} size="sm">
                          {label}
                        </Radio>
                        <Text fontSize="xs" color="gray.500" pl={6}>
                          {hint}
                        </Text>
                      </Box>
                    ))}
                  </VStack>
                </RadioGroup>
                {destination === 'folder' && (
                  <Input
                    mt={2}
                    size="sm"
                    value={destinationPrefix}
                    onChange={(e) => setDestinationPrefix(e.target.value)}
                    onBlur={() => {
                      if (destinationPrefix.trim()) setApplied({ mode: 'folder', prefix: destinationPrefix.trim() })
                    }}
                    placeholder="published/2026-10"
                    aria-label="Destination folder"
                    borderRadius="lg"
                  />
                )}
              </FormControl>

              <FormControl>
                <FormLabel fontSize="sm">If a layer already exists</FormLabel>
                <RadioGroup value={onExists} onChange={(value) => setOnExists(value as OnExists)}>
                  <VStack align="start" spacing={1}>
                    <Radio value="skip" size="sm">
                      Skip it
                    </Radio>
                    <Radio value="replace" size="sm">
                      Replace it
                    </Radio>
                    <Radio value="stop" size="sm">
                      Stop at the first failure or existing layer
                    </Radio>
                  </VStack>
                </RadioGroup>
              </FormControl>
            </VStack>

            <VStack align="stretch" spacing={4} flex={1}>
              <FormControl>
                <FormLabel fontSize="sm">
                  Processing servers: {slots}
                  <Text as="span" fontWeight="normal" color="gray.500" ml={2}>
                    {slots === 1 ? 'one conversion at a time' : `${slots} conversions at a time`}
                  </Text>
                </FormLabel>
                <Slider
                  min={1}
                  max={limits.maxConcurrency}
                  step={1}
                  value={concurrency}
                  onChange={setConcurrency}
                  focusThumbOnChange={false}
                  aria-label="Processing servers"
                >
                  <SliderTrack>
                    <SliderFilledTrack bg="orange.400" />
                  </SliderTrack>
                  <SliderThumb boxSize={5} />
                </Slider>
                <HStack justify="space-between" fontSize="xs" color="gray.500">
                  <Text>1</Text>
                  <Text>{limits.maxConcurrency}</Text>
                </HStack>
              </FormControl>

              {limits.onDemand ? (
                <>
                  <FormControl>
                    <FormLabel fontSize="sm">Server type</FormLabel>
                    <Select
                      size="sm"
                      value={pickedServerId ?? ''}
                      onChange={(e) => setServerTypeId(Number(e.target.value))}
                      borderRadius="lg"
                      aria-label="Server type"
                    >
                      {serverTypes.map((server) => (
                        <option key={server.id} value={server.id} disabled={server.available === false}>
                          {server.label} · {server.price} {server.currency}/h
                          {server.available === false && ' — out of stock'}
                        </option>
                      ))}
                    </Select>
                    {toolStatus && serverTypes.length === 0 ? (
                      <Text fontSize="xs" color="red.600" mt={1} data-testid="bulk-no-server-types">
                        No server type is available: GeoHosting isn&apos;t configured or reachable, or has none enabled
                        for your account.
                      </Text>
                    ) : (
                      <Text fontSize="xs" color="gray.500" mt={1}>
                        Up to {slots} server{slots === 1 ? '' : 's'}, each running one conversion at a time. Billed per
                        started hour, until deleted.
                      </Text>
                    )}
                  </FormControl>
                  <FormControl>
                    <HStack justify="space-between">
                      <FormLabel htmlFor="bulk-auto-destroy" mb={0} fontSize="sm">
                        Auto destroy
                      </FormLabel>
                      <Switch
                        id="bulk-auto-destroy"
                        isChecked={autoDestroy}
                        onChange={(e) => setAutoDestroy(e.target.checked)}
                        colorScheme="orange"
                        size="sm"
                      />
                    </HStack>
                    <Text fontSize="xs" color="gray.500" mt={1}>
                      {autoDestroy
                        ? 'Each server is deleted as soon as the batch has no layer left for it.'
                        : 'The servers keep running (and billed) after the batch: delete them yourself.'}
                    </Text>
                  </FormControl>
                </>
              ) : (
                <Text fontSize="xs" color="gray.600">
                  There is one conversion server, so this is how many conversions it runs at once. Large rasters and
                  point clouds need more memory: keep it low for those.
                </Text>
              )}

              {rasters.length >= 2 && (
                <FormControl>
                  <FormLabel fontSize="sm">VRT</FormLabel>
                  <Checkbox
                    size="sm"
                    isChecked={makesVrt}
                    isDisabled={chosenRasters < 2}
                    onChange={(e) => setCreateVrt(e.target.checked)}
                  >
                    Also publish a VRT of the {chosenRasters} GeoTIFFs
                  </Checkbox>
                  <Text fontSize="xs" color="gray.500" pl={6}>
                    One more collection that opens every converted GeoTIFF as a single raster, e.g. in QGIS. The layers
                    stay separate.
                  </Text>
                  {makesVrt && (
                    <Input
                      mt={2}
                      size="sm"
                      value={vrtName}
                      onChange={(e) => setVrtName(e.target.value)}
                      aria-label="VRT name"
                      placeholder="incoming-vrt"
                      borderRadius="lg"
                    />
                  )}
                </FormControl>
              )}
            </VStack>
          </HStack>
          <Text fontSize="sm" color="gray.700" data-testid="bulk-summary">
            {chosen.size} layer{chosen.size === 1 ? '' : 's'}, {slots} at a time.
          </Text>
          {isStarting && <Progress size="xs" isIndeterminate colorScheme="orange" />}
        </VStack>
      </ModalBody>
      <ModalFooter borderTop="1px solid" borderColor="gray.100" gap={2}>
        <Button variant="ghost" onClick={onBack} borderRadius="lg" isDisabled={isStarting}>
          Back
        </Button>
        <Button variant="ghost" onClick={onClose} borderRadius="lg">
          Cancel
        </Button>
        <Button colorScheme="orange" borderRadius="lg" isLoading={isStarting} isDisabled={!canStart} onClick={start}>
          Start bulk upload
        </Button>
      </ModalFooter>
    </>
  )
}

// Step 3: the batch, as it runs - it carries on if the dialog is closed.
function ProgressStep({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: batch, isError } = useQuery({
    queryKey: ['bulkBatch', batchId],
    queryFn: () => getBulk(batchId),
    refetchInterval: (query) => (query.state.data && !isActiveBatch(query.state.data) ? false : 1000),
  })

  const closeButton = (
    <ModalFooter borderTop="1px solid" borderColor="gray.100">
      <Button variant="ghost" onClick={onClose} borderRadius="lg">
        Close
      </Button>
    </ModalFooter>
  )
  if (isError) {
    return (
      <>
        <ModalBody py={4}>
          <Alert status="warning" borderRadius="lg">
            <AlertIcon />
            This bulk upload is no longer here (the page was reloaded?).
          </Alert>
        </ModalBody>
        {closeButton}
      </>
    )
  }
  if (!batch) {
    return (
      <>
        <ModalBody py={4}>
          <Center py={16}>
            <Spinner />
          </Center>
        </ModalBody>
        {closeButton}
      </>
    )
  }
  const counts = batchCounts(batch)
  const active = isActiveBatch(batch)
  const refresh = (next?: BulkBatch) => {
    if (next) queryClient.setQueryData(['bulkBatch', batchId], next)
    queryClient.invalidateQueries({ queryKey: BULK_BATCHES_QUERY_KEY })
  }
  const run = async (action: () => Promise<BulkBatch>) => {
    try {
      refresh(await action())
    } catch (err) {
      toast({ title: (err as Error).message, status: 'error', duration: 5000 })
    }
  }

  return (
    <>
      <ModalBody py={4}>
        <VStack align="stretch" spacing={4}>
          <Box>
            <HStack justify="space-between" mb={1}>
              <Text fontWeight="600" fontSize="sm">
                {batch.sourceName && `${batch.sourceName}: `}
                {batch.prefix}
              </Text>
              <Badge
                colorScheme={
                  batch.status === 'completed'
                    ? 'green'
                    : batch.status === 'failed'
                      ? 'red'
                      : batch.status === 'partial'
                        ? 'orange'
                        : batch.status === 'cancelled'
                          ? 'gray'
                          : 'blue'
                }
              >
                {batch.status}
              </Badge>
            </HStack>
            <Progress
              value={batchProgress(batch)}
              size="sm"
              colorScheme={counts.failed ? 'orange' : 'blue'}
              borderRadius="md"
              hasStripe={active}
              isAnimated={active}
            />
            {batch.servers && (
              <Text fontSize="xs" color="gray.600" mt={1} data-testid="bulk-servers">
                {serversSummary(batch.servers)}
              </Text>
            )}
            {batch.vrt && (
              <Text
                fontSize="xs"
                mt={1}
                data-testid="bulk-vrt"
                color={batch.vrt.state === 'failed' ? 'red.600' : batch.vrt.state === 'done' ? 'green.700' : 'gray.600'}
              >
                {batch.vrt.message ?? (batch.vrt.state === 'pending' ? 'A VRT follows once the layers are done' : '')}
              </Text>
            )}
            <Text fontSize="xs" color="gray.600" mt={1} data-testid="bulk-summary-line">
              {batchSummary(batch)}
              {counts.waiting > 0 && ` · ${counts.waiting} waiting`}
              {counts.skipped > 0 && ` · ${counts.skipped} skipped`}
              {` · ${batch.concurrency} processing server${batch.concurrency === 1 ? '' : 's'}`}
            </Text>
          </Box>
          <Box border="1px solid" borderColor="gray.200" borderRadius="lg" maxH="340px" overflowY="auto">
            {batch.jobs.map((job) => (
              <Box
                key={job.key}
                px={3}
                py={2}
                borderBottom="1px solid"
                borderColor="gray.100"
                _last={{ borderBottom: 'none' }}
              >
                <HStack spacing={3}>
                  <JobStatusIcon job={job} />
                  <Text fontSize="sm" flex={1} noOfLines={1}>
                    {job.name}
                  </Text>
                  <Badge colorScheme={KIND_COLORS[job.kind]} variant="subtle" fontSize="10px">
                    {KIND_LABELS[job.kind]}
                  </Badge>
                </HStack>
                {job.status === 'running' && (
                  <Progress value={job.progress} size="xs" colorScheme="blue" borderRadius="sm" mt={1.5} />
                )}
                <Text
                  fontSize="xs"
                  color={job.status === 'failed' ? 'red.600' : 'gray.500'}
                  mt={0.5}
                  noOfLines={2}
                  pl={7}
                >
                  {job.status === 'failed' ? job.error : job.message}
                </Text>
              </Box>
            ))}
          </Box>
          <HStack justify="space-between">
            <Text fontSize="xs" color="gray.500">
              {active ? 'You can close this: the batch keeps running, and shows in the Jobs panel.' : ' '}
            </Text>
            <HStack>
              {batch.status === 'cancelled' && (
                <Button
                  size="sm"
                  variant="outline"
                  colorScheme="orange"
                  onClick={() => run(() => restartBulk(batchId))}
                >
                  Restart ({counts.cancelled + counts.failed})
                </Button>
              )}
              {batch.status === 'cancelling' && (
                <Tooltip label="Only if cancelling is stuck - nothing is actually still stopping it">
                  <Button
                    size="sm"
                    variant="outline"
                    colorScheme="orange"
                    onClick={() => run(() => restartBulk(batchId))}
                  >
                    Restart
                  </Button>
                </Tooltip>
              )}
              {counts.failed > 0 && !active && batch.status !== 'cancelled' && (
                <Button size="sm" variant="outline" colorScheme="orange" onClick={() => run(() => retryBulk(batchId))}>
                  Retry failed ({counts.failed})
                </Button>
              )}
              {active && (
                <Button
                  size="sm"
                  variant="outline"
                  colorScheme="red"
                  isDisabled={batch.status === 'cancelling'}
                  onClick={() => run(() => cancelBulk(batchId))}
                >
                  {batch.status === 'cancelling' ? 'Cancelling…' : 'Cancel batch'}
                </Button>
              )}
            </HStack>
          </HStack>
        </VStack>
      </ModalBody>
      {closeButton}
    </>
  )
}

export default function BulkUploadDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  const isOpen = activeDialog === 's3bulk'
  const connectionId = dialogData?.data?.connectionId as string | undefined
  // Opened from the Jobs panel on a running batch, or from a folder.
  const openedBatchId = dialogData?.data?.batchId as string | undefined
  const startFolder = (dialogData?.data?.prefix as string | undefined) ?? ''

  // The bucket the folder is read from: the one the layers go to unless another is picked.
  const [sourceId, setSourceId] = useState('')
  const [step, setStep] = useState<Step>('folder')
  const [browsing, setBrowsing] = useState('')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const { data: connections = [] } = useQuery({
    queryKey: ['s3connections'],
    queryFn: getS3Connections,
    enabled: isOpen && !!connectionId,
  })

  useEffect(() => {
    if (!isOpen) return
    setSourceId(connectionId ?? '')
    setBatchId(openedBatchId ?? null)
    setStep(openedBatchId ? 'progress' : 'folder')
    setBrowsing(folderPrefix(startFolder))
    setIsStarting(false)
  }, [isOpen, openedBatchId, startFolder, connectionId])

  const handleStart = async (options: BulkOptions) => {
    if (!connectionId) return
    setIsStarting(true)
    try {
      const batch = await startBulk(connectionId, options)
      queryClient.invalidateQueries({ queryKey: BULK_BATCHES_QUERY_KEY })
      queryClient.setQueryData(['bulkBatch', batch.id], batch)
      setBatchId(batch.id)
      setStep('progress')
    } catch (err) {
      toast({
        title: "Couldn't start the bulk upload",
        description: (err as Error).message,
        status: 'error',
        duration: 6000,
      })
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="4xl" isCentered scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="90vh">
        <Box bg="surface.header" p={4}>
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiLayers} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Bulk upload
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {STEP_TITLES[step]}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />
        {!connectionId && (
          <>
            <ModalBody py={4}>
              <Alert status="warning" borderRadius="lg">
                <AlertIcon />
                Select an S3 connection first.
              </Alert>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" onClick={closeDialog} borderRadius="lg">
                Cancel
              </Button>
            </ModalFooter>
          </>
        )}
        {connectionId && step === 'folder' && (
          <FolderStep
            connections={connections}
            connectionId={connectionId}
            sourceId={sourceId || connectionId}
            onSource={(id) => {
              setSourceId(id)
              // Another bucket has other folders.
              setBrowsing('')
            }}
            browsing={browsing}
            onBrowse={setBrowsing}
            onNext={() => setStep('review')}
            onClose={closeDialog}
          />
        )}
        {connectionId && step === 'review' && (
          <ReviewStep
            connections={connections}
            connectionId={connectionId}
            sourceId={sourceId || connectionId}
            prefix={browsing}
            onStart={handleStart}
            isStarting={isStarting}
            onBack={() => setStep('folder')}
            onClose={closeDialog}
          />
        )}
        {step === 'progress' && batchId && <ProgressStep batchId={batchId} onClose={closeDialog} />}
      </ModalContent>
    </Modal>
  )
}

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  Box,
  Text,
  VStack,
  HStack,
  Progress,
  Icon,
  Badge,
  useToast,
  useColorModeValue,
  Checkbox,
  Divider,
  Spinner,
  Input,
  FormControl,
  FormLabel,
  Switch,
  Collapse,
  Alert,
  AlertIcon,
} from '@chakra-ui/react'
import {
  FiFile,
  FiCheck,
  FiX,
  FiUploadCloud,
  FiLayers,
  FiDatabase,
  FiImage,
  FiSettings,
  FiChevronDown,
  FiChevronUp,
  FiAlertCircle,
  FiCheckCircle,
  FiPause,
  FiPlay,
  FiUpload,
} from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import {
  initUploadSession,
  uploadChunk,
  cancelUpload,
  completePGUpload,
  CHUNK_SIZE,
} from '../../api/chunkedUpload'

interface SelectedLayer {
  name: string
  selected: boolean
  tableName: string
}

interface ImportJobEntry {
  id: string
  label: string
}

type UploadPhase =
  | 'idle'
  | 'chunking'
  | 'finalizing'
  | 'detecting'
  | 'ready'
  | 'importing'
  | 'tracking'
  | 'done'
  | 'error'
  | 'cancelled'

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return ''
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  return `${m}m ${s}s`
}

function isRasterFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() || ''
  return ['tif', 'tiff', 'img', 'jp2', 'ecw', 'sid', 'asc', 'dem', 'hgt', 'nc', 'vrt'].includes(ext)
}

export default function PGUploadDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const serviceName = dialogData?.data?.serviceName as string | undefined
  const initialSchema = dialogData?.data?.schemaName as string | undefined

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [isPaused, setIsPaused] = useState(false)
  const [chunksUploaded, setChunksUploaded] = useState(0)
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunkProgress, setChunkProgress] = useState(0)
  const [speedBps, setSpeedBps] = useState(0)
  const [etaSeconds, setEtaSeconds] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [assembledPath, setAssembledPath] = useState<string | null>(null)
  const [selectedLayers, setSelectedLayers] = useState<SelectedLayer[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [targetSchema, setTargetSchema] = useState('public')
  const [overwrite, setOverwrite] = useState(false)
  const [targetSRID, setTargetSRID] = useState<number | undefined>(undefined)
  const [ogrStatus, setOgrStatus] = useState<api.OGR2OGRStatus | null>(null)
  const [ogrLoading, setOgrLoading] = useState(false)
  const [importJobEntries, setImportJobEntries] = useState<ImportJobEntry[]>([])
  const [importJobs, setImportJobs] = useState<Record<string, api.ImportJob>>({})

  const sessionIdRef = useRef<string | null>(null)
  const isPausedRef = useRef(false)
  const isCancelledRef = useRef(false)

  const dropzoneBg = useColorModeValue('gray.50', 'gray.700')
  const dropzoneBorderColor = useColorModeValue('gray.300', 'gray.600')

  const isOpen = activeDialog === 'pgupload'
  const isRaster = selectedFile ? isRasterFile(selectedFile.name) : false
  const isUploading = phase === 'chunking' || phase === 'finalizing'
  const overallPct = chunksTotal > 0 ? Math.round((chunksUploaded / chunksTotal) * 100) : 0
  const selectedLayerCount = selectedLayers.filter((l) => l.selected).length

  const resetState = useCallback(() => {
    setSelectedFile(null)
    setPhase('idle')
    setIsPaused(false)
    setChunksUploaded(0)
    setChunksTotal(0)
    setChunkProgress(0)
    setSpeedBps(0)
    setEtaSeconds(0)
    setErrorMsg('')
    setAssembledPath(null)
    setSelectedLayers([])
    setShowAdvanced(false)
    setTargetSchema(initialSchema || 'public')
    setOverwrite(false)
    setTargetSRID(undefined)
    setImportJobEntries([])
    setImportJobs({})
    sessionIdRef.current = null
    isPausedRef.current = false
    isCancelledRef.current = false
  }, [initialSchema])

  useEffect(() => {
    if (isOpen) {
      resetState()
      setOgrLoading(true)
      api.getOGR2OGRStatus()
        .then(setOgrStatus)
        .catch(console.error)
        .finally(() => setOgrLoading(false))
    }
  }, [isOpen, resetState])

  useEffect(() => {
    if (phase !== 'tracking' || importJobEntries.length === 0) return

    let cancelled = false

    const poll = async () => {
      if (cancelled) return
      const results = await Promise.all(
        importJobEntries.map(async ({ id }) => {
          try {
            const data = await api.getImportJobStatus(id)
            return { id, data }
          } catch {
            return { id, data: null }
          }
        })
      )
      if (cancelled) return

      const updated: Record<string, api.ImportJob> = {}
      for (const { id, data } of results) {
        if (data) updated[id] = data
      }
      setImportJobs(updated)

      const allDone = importJobEntries.every(({ id }) => {
        const job = updated[id]
        return job?.status === 'completed' || job?.status === 'failed'
      })
      if (allDone) {
        setPhase('done')
        queryClient.invalidateQueries({ queryKey: ['pgschemas', serviceName] })
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [phase, importJobEntries, serviceName, queryClient])

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file)
    setPhase('idle')
    setErrorMsg('')
    setAssembledPath(null)
    setSelectedLayers([])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const waitIfPaused = (): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (!isPausedRef.current || isCancelledRef.current) resolve()
        else setTimeout(check, 200)
      }
      check()
    })

  const handleUpload = async () => {
    if (!selectedFile || !serviceName) return

    isCancelledRef.current = false
    isPausedRef.current = false
    setPhase('chunking')
    setChunksUploaded(0)
    setChunkProgress(0)
    setSpeedBps(0)
    setEtaSeconds(0)

    const totalBytes = selectedFile.size
    const startTime = Date.now()
    let bytesUploaded = 0

    try {
      const { sessionId, totalChunks } = await initUploadSession('', '', selectedFile.name, totalBytes, CHUNK_SIZE)
      sessionIdRef.current = sessionId
      setChunksTotal(totalChunks)

      for (let i = 0; i < totalChunks; i++) {
        if (isCancelledRef.current) break
        await waitIfPaused()
        if (isCancelledRef.current) break

        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, totalBytes)
        const chunk = selectedFile.slice(start, end)
        const chunkBytes = end - start

        await uploadChunk(sessionId, i, chunk, (pct) => setChunkProgress(pct))

        bytesUploaded += chunkBytes
        const elapsedSec = (Date.now() - startTime) / 1000
        const speed = elapsedSec > 0 ? bytesUploaded / elapsedSec : 0
        const eta = speed > 0 ? (totalBytes - bytesUploaded) / speed : 0

        setChunksUploaded(i + 1)
        setChunkProgress(100)
        setSpeedBps(speed)
        setEtaSeconds(eta)
      }

      if (isCancelledRef.current) {
        setPhase('cancelled')
        return
      }

      setPhase('finalizing')
      const result = await completePGUpload(sessionId)
      const filePath = result.path

      if (!filePath) throw new Error('Server did not return file path')

      setAssembledPath(filePath)

      // Detect layers for vector files
      if (!isRaster) {
        setPhase('detecting')
        try {
          const layers = await api.detectLayers(filePath)
          const detected = layers.length > 0
            ? layers.map((l) => ({
                name: l.name,
                selected: true,
                tableName: l.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
              }))
            : [{
                name: selectedFile.name.replace(/\.[^/.]+$/, ''),
                selected: true,
                tableName: selectedFile.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
              }]
          setSelectedLayers(detected)
        } catch {
          const baseName = selectedFile.name.replace(/\.[^/.]+$/, '')
          setSelectedLayers([{ name: baseName, selected: true, tableName: baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_') }])
        }
      }

      setPhase('ready')
    } catch (err) {
      if (!isCancelledRef.current) {
        const msg = (err as Error).message
        setErrorMsg(msg)
        setPhase('error')
        toast({ title: 'Upload failed', description: msg, status: 'error', duration: 5000 })
      }
    }
  }

  const handlePause = () => { isPausedRef.current = true; setIsPaused(true) }
  const handleResume = () => { isPausedRef.current = false; setIsPaused(false) }

  const handleCancel = async () => {
    isCancelledRef.current = true
    isPausedRef.current = false
    setIsPaused(false)
    const sessId = sessionIdRef.current
    if (sessId) {
      try { await cancelUpload(sessId) } catch { /* best effort */ }
    }
    setPhase('cancelled')
  }

  const handleImport = async () => {
    if (!serviceName || !assembledPath) return
    setPhase('importing')

    try {
      const entries: ImportJobEntry[] = []

      if (isRaster) {
        const result = await api.startRasterImport({
          filePath: assembledPath,
          serviceName,
          schema: targetSchema,
          overwrite,
        })
        entries.push({ id: result.jobId, label: selectedFile?.name ?? 'Raster import' })
      } else {
        for (const layer of selectedLayers.filter((l) => l.selected)) {
          const result = await api.startVectorImport({
            filePath: assembledPath,
            serviceName,
            schema: targetSchema,
            tableName: layer.tableName,
            sourceLayer: layer.name,
            overwrite,
            srid: targetSRID,
          })
          entries.push({ id: result.jobId, label: layer.name })
        }
      }

      setImportJobEntries(entries)
      setPhase('tracking')
    } catch (err) {
      const msg = (err as Error).message
      setErrorMsg(msg)
      setPhase('error')
      toast({ title: 'Import failed', description: msg, status: 'error', duration: 5000 })
    }
  }

  const toggleLayerSelection = (layerName: string) => {
    setSelectedLayers((prev) => prev.map((l) => l.name === layerName ? { ...l, selected: !l.selected } : l))
  }

  const updateLayerTableName = (layerName: string, tableName: string) => {
    setSelectedLayers((prev) => prev.map((l) => l.name === layerName ? { ...l, tableName } : l))
  }

  const handleClose = () => {
    resetState()
    closeDialog()
  }

  if (ogrLoading || !ogrStatus?.available) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} size="lg" isCentered>
        <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
        <ModalContent borderRadius="xl" overflow="hidden">
          <Box bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)" px={6} py={4}>
            <HStack spacing={3}>
              <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
                <Icon as={FiDatabase} boxSize={5} color="white" />
              </Box>
              <Text color="white" fontWeight="600" fontSize="lg">Import Data to PostgreSQL</Text>
            </HStack>
          </Box>
          <ModalCloseButton color="white" />
          <ModalBody py={6}>
            {ogrLoading ? (
              <VStack spacing={4} align="center">
                <Spinner size="xl" color="blue.500" />
                <Text color="gray.500">Checking import tools…</Text>
              </VStack>
            ) : (
              <VStack spacing={4} align="center">
                <Icon as={FiX} boxSize={12} color="red.500" />
                <Text fontWeight="600" fontSize="lg">Import Tools Not Available</Text>
                <Text color="gray.500" textAlign="center">
                  ogr2ogr and raster2pgsql are required. Please install GDAL and PostGIS on the server.
                </Text>
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={handleClose} isDisabled={ogrLoading}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="85vh">
        <Box bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)" px={6} py={4}>
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiDatabase} boxSize={5} color="white" />
            </Box>
            <Box flex="1">
              <Text color="white" fontWeight="600" fontSize="lg">Import Data to PostgreSQL</Text>
              <HStack spacing={2}>
                <Text color="whiteAlpha.800" fontSize="sm">Target:</Text>
                {serviceName ? (
                  <Badge bg="whiteAlpha.200" color="white" fontSize="xs">{serviceName}</Badge>
                ) : (
                  <Text color="whiteAlpha.600" fontSize="sm" fontStyle="italic">No service selected</Text>
                )}
              </HStack>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6} overflowY="auto">
          <VStack spacing={4}>
            {/* Dropzone — only when idle or cancelled */}
            {(phase === 'idle' || phase === 'cancelled') && (
              <Box
                w="100%"
                p={8}
                bg={selectedFile ? 'purple.50' : dropzoneBg}
                border="2px dashed"
                borderColor={selectedFile ? 'purple.400' : dropzoneBorderColor}
                borderRadius="xl"
                textAlign="center"
                cursor="pointer"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                _hover={{ borderColor: 'purple.500', bg: 'purple.50' }}
                transition="all 0.2s"
              >
                {selectedFile ? (
                  <VStack spacing={2}>
                    <Icon as={isRaster ? FiImage : FiFile} boxSize={8} color="purple.500" />
                    <Text fontWeight="500">{selectedFile.name}</Text>
                    <Text fontSize="sm" color="gray.500">{formatFileSize(selectedFile.size)}</Text>
                    {isRaster && <Badge colorScheme="purple">Raster</Badge>}
                  </VStack>
                ) : (
                  <VStack spacing={3}>
                    <Box bg="purple.50" p={4} borderRadius="full">
                      <Icon as={FiUploadCloud} boxSize={10} color="purple.500" />
                    </Box>
                    <VStack spacing={1}>
                      <Text fontWeight="600" color="gray.700">Drop a file here or click to browse</Text>
                      <Text fontSize="sm" color="gray.500">GeoPackage, Shapefile, GeoJSON, GeoTIFF, and more</Text>
                    </VStack>
                  </VStack>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".gpkg,.shp,.zip,.geojson,.json,.kml,.tif,.tiff,.gml"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
                />
              </Box>
            )}

            {/* Upload progress */}
            {(isUploading || phase === 'done' || phase === 'cancelled' || phase === 'detecting' || phase === 'ready' || phase === 'importing' || phase === 'error') && selectedFile && (
              <Box
                w="100%"
                p={4}
                bg={dropzoneBg}
                borderRadius="lg"
                border="1px solid"
                borderColor={
                  phase === 'done' ? 'green.200' :
                  phase === 'cancelled' ? 'orange.200' :
                  phase === 'error' ? 'red.200' : 'gray.200'
                }
              >
                <VStack align="stretch" spacing={3}>
                  <HStack>
                    <Icon as={isRaster ? FiImage : FiFile} color="purple.500" />
                    <Text fontWeight="500" flex="1" noOfLines={1}>{selectedFile.name}</Text>
                    <Text fontSize="sm" color="gray.500">{formatFileSize(selectedFile.size)}</Text>
                    {isRaster && <Badge colorScheme="purple" size="sm">Raster</Badge>}
                  </HStack>

                  {phase === 'chunking' && chunksTotal > 0 && (
                    <>
                      <Box>
                        <HStack justify="space-between" mb={1}>
                          <Text fontSize="xs" color="gray.500">
                            {chunksTotal > 1 ? `Chunks: ${chunksUploaded}/${chunksTotal}` : 'Uploading…'}
                          </Text>
                          <HStack spacing={3}>
                            {speedBps > 0 && <Text fontSize="xs" color="gray.500">{formatSpeed(speedBps)}</Text>}
                            {etaSeconds > 0 && <Text fontSize="xs" color="gray.500">ETA: {formatEta(etaSeconds)}</Text>}
                          </HStack>
                        </HStack>
                        <Progress
                          value={overallPct}
                          size="sm"
                          colorScheme={isPaused ? 'yellow' : 'purple'}
                          borderRadius="full"
                          hasStripe={!isPaused}
                          isAnimated={!isPaused}
                        />
                      </Box>
                      {chunksTotal > 1 && (
                        <Box>
                          <Text fontSize="xs" color="gray.400" mb={1}>Current chunk: {chunkProgress}%</Text>
                          <Progress value={chunkProgress} size="xs" colorScheme="blue" borderRadius="full" opacity={0.7} />
                        </Box>
                      )}
                      <HStack spacing={2} justify="flex-end">
                        {!isPaused ? (
                          <Button size="xs" variant="outline" colorScheme="yellow" onClick={handlePause} leftIcon={<FiPause />}>Pause</Button>
                        ) : (
                          <Button size="xs" variant="outline" colorScheme="green" onClick={handleResume} leftIcon={<FiPlay />}>Resume</Button>
                        )}
                        <Button size="xs" variant="ghost" colorScheme="red" onClick={handleCancel}>Cancel</Button>
                      </HStack>
                    </>
                  )}

                  {phase === 'finalizing' && (
                    <Box>
                      <Text fontSize="xs" color="blue.500" fontWeight="500" mb={1}>Assembling file…</Text>
                      <Progress isIndeterminate size="sm" colorScheme="blue" borderRadius="full" />
                    </Box>
                  )}

                  {phase === 'detecting' && (
                    <HStack spacing={2} color="gray.500">
                      <Spinner size="sm" />
                      <Text fontSize="sm">Detecting layers…</Text>
                    </HStack>
                  )}

                  {(phase === 'ready' || phase === 'importing' || phase === 'done') && (
                    <Text fontSize="sm" color="green.600" fontWeight="500">
                      <Icon as={FiCheck} mr={1} />
                      File ready
                    </Text>
                  )}

                  {phase === 'cancelled' && (
                    <Text fontSize="sm" color="orange.500">Upload cancelled</Text>
                  )}
                </VStack>
              </Box>
            )}

            {/* Layer selection */}
            {(phase === 'ready' || phase === 'importing' || phase === 'done') && !isRaster && selectedLayers.length > 0 && (
              <>
                <Divider />
                <Box w="100%">
                  <HStack justify="space-between" mb={3}>
                    <HStack>
                      <Icon as={FiLayers} color="purple.500" />
                      <Text fontWeight="600">Layers to Import</Text>
                    </HStack>
                    <HStack spacing={2}>
                      <Button size="xs" variant="outline" colorScheme="purple"
                        onClick={() => setSelectedLayers((p) => p.map((l) => ({ ...l, selected: true })))}
                        isDisabled={selectedLayers.every((l) => l.selected)}>
                        Select All
                      </Button>
                      <Button size="xs" variant="outline"
                        onClick={() => setSelectedLayers((p) => p.map((l) => ({ ...l, selected: false })))}
                        isDisabled={selectedLayers.every((l) => !l.selected)}>
                        Deselect All
                      </Button>
                      <Badge colorScheme="purple">{selectedLayerCount} selected</Badge>
                    </HStack>
                  </HStack>
                  <VStack align="stretch" spacing={2} maxH="200px" overflowY="auto">
                    {selectedLayers.map((layer) => (
                      <Box key={layer.name} p={2} bg={dropzoneBg} borderRadius="md" border="1px solid"
                        borderColor={layer.selected ? 'purple.200' : 'gray.200'}>
                        <HStack spacing={3}>
                          <Checkbox isChecked={layer.selected} onChange={() => toggleLayerSelection(layer.name)} colorScheme="purple" />
                          <VStack align="stretch" flex="1" spacing={1}>
                            <Text fontSize="sm" fontWeight="500">{layer.name}</Text>
                            <Input size="xs" value={layer.tableName}
                              onChange={(e) => updateLayerTableName(layer.name, e.target.value)}
                              placeholder="Table name" isDisabled={!layer.selected} />
                          </VStack>
                        </HStack>
                      </Box>
                    ))}
                  </VStack>
                </Box>
              </>
            )}

            {/* Advanced options */}
            {(phase === 'ready' || phase === 'importing' || phase === 'done') && (
              <>
                <Divider />
                <Box w="100%">
                  <Button variant="ghost" size="sm"
                    leftIcon={showAdvanced ? <FiChevronUp /> : <FiChevronDown />}
                    rightIcon={<FiSettings />}
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    w="100%" justifyContent="space-between">
                    Advanced Options
                  </Button>
                  <Collapse in={showAdvanced}>
                    <VStack spacing={4} mt={3} align="stretch" p={3} bg={dropzoneBg} borderRadius="md">
                      <FormControl>
                        <FormLabel fontSize="sm">Target Schema</FormLabel>
                        <Input size="sm" value={targetSchema} onChange={(e) => setTargetSchema(e.target.value)} placeholder="public" />
                      </FormControl>
                      <FormControl>
                        <FormLabel fontSize="sm">Target SRID (leave empty to keep source)</FormLabel>
                        <Input size="sm" type="number" value={targetSRID || ''}
                          onChange={(e) => setTargetSRID(e.target.value ? parseInt(e.target.value) : undefined)}
                          placeholder="e.g. 4326" />
                      </FormControl>
                      <FormControl display="flex" alignItems="center">
                        <FormLabel fontSize="sm" mb="0">Overwrite existing tables</FormLabel>
                        <Switch colorScheme="purple" isChecked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                      </FormControl>
                    </VStack>
                  </Collapse>
                </Box>
              </>
            )}

            {/* Error */}
            {phase === 'error' && (
              <Alert status="error" borderRadius="lg" variant="subtle">
                <AlertIcon as={FiAlertCircle} />
                <Text fontSize="sm">{errorMsg}</Text>
              </Alert>
            )}

            {/* Job tracking */}
            {(phase === 'tracking' || phase === 'done') && importJobEntries.length > 0 && (
              <>
                <Divider />
                <Box w="100%">
                  <HStack mb={3}>
                    <Icon as={FiDatabase} color="blue.500" />
                    <Text fontWeight="600">Import Jobs</Text>
                    {phase === 'tracking' && <Spinner size="sm" color="blue.500" />}
                  </HStack>
                  <VStack align="stretch" spacing={2}>
                    {importJobEntries.map((entry) => {
                      const job = importJobs[entry.id]
                      const status = job?.status ?? 'pending'
                      const progress = job?.progress ?? 0
                      const statusColor =
                        status === 'completed' ? 'green' :
                        status === 'failed' ? 'red' :
                        status === 'running' ? 'blue' : 'gray'
                      return (
                        <Box key={entry.id} p={3} bg={dropzoneBg} borderRadius="md" border="1px solid"
                          borderColor={`${statusColor}.200`}>
                          <HStack justify="space-between" mb={status === 'running' || status === 'pending' ? 2 : 0}>
                            <HStack spacing={2} flex="1" minW={0}>
                              {status === 'completed' && <Icon as={FiCheckCircle} color="green.500" flexShrink={0} />}
                              {status === 'failed' && <Icon as={FiX} color="red.500" flexShrink={0} />}
                              {(status === 'running' || status === 'pending') && <Spinner size="xs" color="blue.500" flexShrink={0} />}
                              <Text fontSize="sm" fontWeight="500" noOfLines={1}>{entry.label}</Text>
                            </HStack>
                            <Badge colorScheme={statusColor} flexShrink={0}>{status}</Badge>
                          </HStack>
                          {(status === 'running' || status === 'pending') && (
                            <Progress
                              value={progress}
                              size="xs"
                              colorScheme="blue"
                              borderRadius="full"
                              hasStripe
                              isAnimated
                            />
                          )}
                          {job?.message && status !== 'failed' && (
                            <Text fontSize="xs" color="gray.500" mt={1}>{job.message}</Text>
                          )}
                          {status === 'failed' && (
                            <Text fontSize="xs" color="red.500" mt={1}>{job?.error ?? job?.message}</Text>
                          )}
                        </Box>
                      )
                    })}
                  </VStack>
                </Box>
              </>
            )}
          </VStack>
        </ModalBody>

        <ModalFooter gap={3} borderTop="1px solid" borderTopColor="gray.100" bg="gray.50">
          <Button variant="ghost" onClick={handleClose} borderRadius="lg">
            {phase === 'done' || phase === 'tracking' ? 'Close' : 'Cancel'}
          </Button>

          {phase === 'ready' && (
            <Button
              colorScheme="green"
              onClick={handleImport}
              isDisabled={!isRaster && selectedLayerCount === 0}
              leftIcon={<FiDatabase />}
              borderRadius="lg"
              px={6}
            >
              Import to PostgreSQL
            </Button>
          )}

          {phase === 'importing' && (
            <Button colorScheme="green" isLoading loadingText="Importing…" borderRadius="lg" px={6}>
              Import to PostgreSQL
            </Button>
          )}

          {phase === 'tracking' && (
            <Button colorScheme="blue" isLoading loadingText="Tracking jobs…" borderRadius="lg" px={6}>
              Tracking
            </Button>
          )}

          {(phase === 'idle' || phase === 'cancelled' || phase === 'error') && (
            <Button
              colorScheme="purple"
              onClick={handleUpload}
              isDisabled={!selectedFile || !serviceName}
              leftIcon={<FiUpload />}
              borderRadius="lg"
              px={6}
            >
              Upload
            </Button>
          )}

          {isUploading && (
            <Button colorScheme="purple" isLoading
              loadingText={phase === 'finalizing' ? 'Assembling…' : 'Uploading…'}
              borderRadius="lg" px={6}>
              Upload
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
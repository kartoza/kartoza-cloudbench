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
  Divider,
  Spinner,
  Input,
  FormControl,
  FormLabel,
} from '@chakra-ui/react'
import {
  FiFile,
  FiCheck,
  FiX,
  FiUploadCloud,
  FiLayers,
  FiDatabase,
  FiCheckCircle,
  FiPause,
  FiPlay,
  FiUpload,
} from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import { useTreeStore } from '../../stores/treeStore'
import { useConnectionStore } from '../../stores/connectionStore'
import * as api from '../../api'
import {
  initUploadSession,
  uploadChunk,
  cancelUpload,
  completeGeoServerUpload,
  CHUNK_SIZE,
} from '../../api/chunkedUpload'

interface GeoServerUploadResult {
  label: string
  status: 'completed' | 'failed'
  storeName?: string
  storeType?: string
  error?: string
}

type UploadPhase =
  | 'idle'
  | 'chunking'
  | 'finalizing'
  | 'ready'
  | 'uploading_gs'
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

export default function UploadDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId)
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const connectionId =
    (dialogData?.data?.connectionId as string | undefined) ||
    selectedNode?.connectionId ||
    activeConnectionId
  const workspace =
    (dialogData?.data?.workspace as string | undefined) ||
    (selectedNode?.workspace as string | undefined)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [storeName, setStoreName] = useState('')
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [isPaused, setIsPaused] = useState(false)
  const [chunksUploaded, setChunksUploaded] = useState(0)
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunkProgress, setChunkProgress] = useState(0)
  const [speedBps, setSpeedBps] = useState(0)
  const [etaSeconds, setEtaSeconds] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [assembledPath, setAssembledPath] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<GeoServerUploadResult | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const isPausedRef = useRef(false)
  const isCancelledRef = useRef(false)

  const dropzoneBg = useColorModeValue('gray.50', 'gray.700')
  const dropzoneBorderColor = useColorModeValue('gray.300', 'gray.600')

  const isOpen = activeDialog === 'upload'
  const isUploading = phase === 'chunking' || phase === 'finalizing'
  const overallPct = chunksTotal > 0 ? Math.round((chunksUploaded / chunksTotal) * 100) : 0

  const resetState = useCallback(() => {
    setSelectedFile(null)
    setStoreName('')
    setPhase('idle')
    setIsPaused(false)
    setChunksUploaded(0)
    setChunksTotal(0)
    setChunkProgress(0)
    setSpeedBps(0)
    setEtaSeconds(0)
    setErrorMsg('')
    setAssembledPath(null)
    setUploadResult(null)
    sessionIdRef.current = null
    isPausedRef.current = false
    isCancelledRef.current = false
  }, [])

  useEffect(() => {
    if (isOpen) resetState()
  }, [isOpen, resetState])

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file)
    setPhase('idle')
    setErrorMsg('')
    setAssembledPath(null)
    const base = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_')
    setStoreName(base)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect],
  )

  const waitIfPaused = (): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (!isPausedRef.current || isCancelledRef.current) resolve()
        else setTimeout(check, 200)
      }
      check()
    })

  const handleUpload = async () => {
    if (!selectedFile || !connectionId || !workspace) return

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
      const { sessionId, totalChunks } = await initUploadSession(
        connectionId,
        workspace,
        selectedFile.name,
        totalBytes,
        CHUNK_SIZE,
      )
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
      const result = await completeGeoServerUpload(sessionId, connectionId, workspace, storeName)
      setAssembledPath(result.path)
      setStoreName(result.storeName)
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

  const handlePause = () => {
    isPausedRef.current = true
    setIsPaused(true)
  }
  const handleResume = () => {
    isPausedRef.current = false
    setIsPaused(false)
  }

  const handleCancel = async () => {
    isCancelledRef.current = true
    isPausedRef.current = false
    setIsPaused(false)
    const sessId = sessionIdRef.current
    if (sessId) {
      try {
        await cancelUpload(sessId)
      } catch {
        /* best effort */
      }
    }
    setPhase('cancelled')
  }

  const handleSendToGeoServer = async () => {
    if (!connectionId || !workspace || !assembledPath || !storeName) return
    setPhase('uploading_gs')

    const label = selectedFile?.name ?? storeName
    try {
      const result = await api.startGeoServerUpload(connectionId, workspace, assembledPath, storeName)
      setUploadResult({ label, status: 'completed', storeName: result.storeName, storeType: result.storeType })
    } catch (err) {
      setUploadResult({ label, status: 'failed', error: (err as Error).message })
    }
    setPhase('done')
    queryClient.invalidateQueries({ queryKey: ['datastores', connectionId, workspace] })
    queryClient.invalidateQueries({ queryKey: ['coveragestores', connectionId, workspace] })
    queryClient.invalidateQueries({ queryKey: ['layers', connectionId, workspace] })
  }

  const handleClose = () => {
    resetState()
    closeDialog()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="85vh">
        <Box bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)" px={6} py={4}>
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiUploadCloud} boxSize={5} color="white" />
            </Box>
            <Box flex="1">
              <Text color="white" fontWeight="600" fontSize="lg">
                Upload to GeoServer
              </Text>
              <HStack spacing={2}>
                <Text color="whiteAlpha.800" fontSize="sm">
                  Workspace:
                </Text>
                {workspace ? (
                  <Badge bg="whiteAlpha.200" color="white" fontSize="xs">
                    {workspace}
                  </Badge>
                ) : (
                  <Text color="whiteAlpha.600" fontSize="sm" fontStyle="italic">
                    No workspace selected
                  </Text>
                )}
              </HStack>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6} overflowY="auto">
          <VStack spacing={4}>
            {/* Dropzone */}
            {(phase === 'idle' || phase === 'cancelled' || phase === 'error') && (
              <Box
                w="100%"
                p={8}
                bg={selectedFile ? 'kartoza.50' : dropzoneBg}
                border="2px dashed"
                borderColor={selectedFile ? 'kartoza.400' : dropzoneBorderColor}
                borderRadius="xl"
                textAlign="center"
                cursor="pointer"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                _hover={{ borderColor: 'kartoza.500', bg: 'kartoza.50' }}
                transition="all 0.2s"
              >
                {selectedFile ? (
                  <VStack spacing={2}>
                    <Icon as={FiFile} boxSize={8} color="kartoza.500" />
                    <Text fontWeight="500">{selectedFile.name}</Text>
                    <Text fontSize="sm" color="gray.500">
                      {formatFileSize(selectedFile.size)}
                    </Text>
                  </VStack>
                ) : (
                  <VStack spacing={3}>
                    <Box bg="kartoza.50" p={4} borderRadius="full">
                      <Icon as={FiUploadCloud} boxSize={10} color="kartoza.500" />
                    </Box>
                    <VStack spacing={1}>
                      <Text fontWeight="600" color="gray.700">
                        Drop a file here or click to browse
                      </Text>
                      <Text fontSize="sm" color="gray.500">
                        Shapefile (.zip), GeoPackage (.gpkg), GeoTIFF (.tif)
                      </Text>
                    </VStack>
                  </VStack>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.gpkg,.tif,.tiff"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFileSelect(f)
                  }}
                />
              </Box>
            )}

            {/* Store name input — shown once file selected */}
            {selectedFile && (phase === 'idle' || phase === 'cancelled' || phase === 'error' || phase === 'ready') && (
              <FormControl>
                <FormLabel fontSize="sm">Store Name</FormLabel>
                <Input
                  size="sm"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. my_store"
                  isReadOnly={phase === 'ready'}
                />
              </FormControl>
            )}

            {/* Upload progress */}
            {(isUploading || phase === 'ready' || phase === 'uploading_gs') && selectedFile && (
              <Box
                w="100%"
                p={4}
                bg={dropzoneBg}
                borderRadius="lg"
                border="1px solid"
                borderColor="gray.200"
              >
                <VStack align="stretch" spacing={3}>
                  <HStack>
                    <Icon as={FiFile} color="kartoza.500" />
                    <Text fontWeight="500" flex="1" noOfLines={1}>
                      {selectedFile.name}
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      {formatFileSize(selectedFile.size)}
                    </Text>
                  </HStack>

                  {phase === 'chunking' && chunksTotal > 0 && (
                    <>
                      <Box>
                        <HStack justify="space-between" mb={1}>
                          <Text fontSize="xs" color="gray.500">
                            {chunksTotal > 1 ? `Chunks: ${chunksUploaded}/${chunksTotal}` : 'Uploading…'}
                          </Text>
                          <HStack spacing={3}>
                            {speedBps > 0 && (
                              <Text fontSize="xs" color="gray.500">
                                {formatSpeed(speedBps)}
                              </Text>
                            )}
                            {etaSeconds > 0 && (
                              <Text fontSize="xs" color="gray.500">
                                ETA: {formatEta(etaSeconds)}
                              </Text>
                            )}
                          </HStack>
                        </HStack>
                        <Progress
                          value={overallPct}
                          size="sm"
                          colorScheme={isPaused ? 'yellow' : 'kartoza'}
                          borderRadius="full"
                          hasStripe={!isPaused}
                          isAnimated={!isPaused}
                        />
                      </Box>
                      {chunksTotal > 1 && (
                        <Box>
                          <Text fontSize="xs" color="gray.400" mb={1}>
                            Current chunk: {chunkProgress}%
                          </Text>
                          <Progress
                            value={chunkProgress}
                            size="xs"
                            colorScheme="blue"
                            borderRadius="full"
                            opacity={0.7}
                          />
                        </Box>
                      )}
                      <HStack spacing={2} justify="flex-end">
                        {!isPaused ? (
                          <Button
                            size="xs"
                            variant="outline"
                            colorScheme="yellow"
                            onClick={handlePause}
                            leftIcon={<FiPause />}
                          >
                            Pause
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            colorScheme="green"
                            onClick={handleResume}
                            leftIcon={<FiPlay />}
                          >
                            Resume
                          </Button>
                        )}
                        <Button size="xs" variant="ghost" colorScheme="red" onClick={handleCancel}>
                          Cancel
                        </Button>
                      </HStack>
                    </>
                  )}

                  {phase === 'finalizing' && (
                    <Box>
                      <Text fontSize="xs" color="blue.500" fontWeight="500" mb={1}>
                        Assembling file…
                      </Text>
                      <Progress isIndeterminate size="sm" colorScheme="blue" borderRadius="full" />
                    </Box>
                  )}

                  {phase === 'ready' && (
                    <Text fontSize="sm" color="green.600" fontWeight="500">
                      <Icon as={FiCheck} mr={1} />
                      File ready — click "Send to GeoServer" to start import
                    </Text>
                  )}

                  {phase === 'uploading_gs' && (
                    <HStack spacing={2} color="blue.500">
                      <Spinner size="sm" />
                      <Text fontSize="sm">Uploading to GeoServer…</Text>
                    </HStack>
                  )}
                </VStack>
              </Box>
            )}

            {/* Error */}
            {phase === 'error' && errorMsg && (
              <Box w="100%" p={3} bg="red.50" borderRadius="lg" border="1px solid" borderColor="red.200">
                <Text fontSize="sm" color="red.600">
                  {errorMsg}
                </Text>
              </Box>
            )}

            {/* Upload result */}
            {phase === 'done' && uploadResult && (
              <>
                <Divider />
                <Box w="100%">
                  <HStack mb={3}>
                    <Icon as={FiLayers} color="blue.500" />
                    <Text fontWeight="600">Upload Result</Text>
                  </HStack>
                  <Box
                    p={3}
                    bg={dropzoneBg}
                    borderRadius="md"
                    border="1px solid"
                    borderColor={uploadResult.status === 'completed' ? 'green.200' : 'red.200'}
                  >
                    <HStack justify="space-between">
                      <HStack spacing={2} flex="1" minW={0}>
                        {uploadResult.status === 'completed'
                          ? <Icon as={FiCheckCircle} color="green.500" flexShrink={0} />
                          : <Icon as={FiX} color="red.500" flexShrink={0} />}
                        <Text fontSize="sm" fontWeight="500" noOfLines={1}>{uploadResult.label}</Text>
                        {uploadResult.storeType && (
                          <Badge colorScheme="blue" fontSize="xs">{uploadResult.storeType}</Badge>
                        )}
                      </HStack>
                      <Badge colorScheme={uploadResult.status === 'completed' ? 'green' : 'red'} flexShrink={0}>
                        {uploadResult.status}
                      </Badge>
                    </HStack>
                    {uploadResult.status === 'failed' && uploadResult.error && (
                      <Text fontSize="xs" color="red.500" mt={1}>{uploadResult.error}</Text>
                    )}
                  </Box>
                </Box>
              </>
            )}
          </VStack>
        </ModalBody>

        <ModalFooter gap={3} borderTop="1px solid" borderTopColor="gray.100" bg="gray.50">
          <Button variant="ghost" onClick={handleClose} borderRadius="lg">
            {phase === 'done' ? 'Close' : 'Cancel'}
          </Button>

          {/* Upload chunks button */}
          {(phase === 'idle' || phase === 'cancelled' || phase === 'error') && (
            <Button
              colorScheme="kartoza"
              onClick={handleUpload}
              isDisabled={!selectedFile || !connectionId || !workspace || !storeName}
              leftIcon={<FiUpload />}
              borderRadius="lg"
              px={6}
            >
              Upload
            </Button>
          )}

          {isUploading && (
            <Button
              colorScheme="kartoza"
              isLoading
              loadingText={phase === 'finalizing' ? 'Assembling…' : 'Uploading…'}
              borderRadius="lg"
              px={6}
            >
              Upload
            </Button>
          )}

          {/* Send to GeoServer button */}
          {phase === 'ready' && (
            <Button
              colorScheme="green"
              onClick={handleSendToGeoServer}
              isDisabled={!storeName}
              leftIcon={<FiDatabase />}
              borderRadius="lg"
              px={6}
            >
              Send to GeoServer
            </Button>
          )}

          {phase === 'uploading_gs' && (
            <Button colorScheme="green" isLoading loadingText="Uploading…" borderRadius="lg" px={6}>
              Send to GeoServer
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

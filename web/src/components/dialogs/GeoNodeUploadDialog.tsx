import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  ButtonGroup,
  FormControl,
  FormLabel,
  Input,
  VStack,
  HStack,
  Text,
  Icon,
  Box,
  useToast,
  Progress,
  Textarea,
  Badge,
  Alert,
  AlertIcon,
  useColorModeValue,
} from '@chakra-ui/react'
import { FiUpload, FiFile, FiCheckCircle, FiAlertCircle, FiPause, FiPlay, FiLayers, FiFileText } from 'react-icons/fi'
import { TbWorld } from 'react-icons/tb'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import {
  initUploadSession,
  uploadChunk,
  cancelUpload,
  completeGeoNodeUpload,
  CHUNK_SIZE,
} from '../../api/chunkedUpload'

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

function getSupportedFileInfo(filename: string): { supported: boolean; type: string; description: string } {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'gpkg':
      return { supported: true, type: 'GeoPackage', description: 'Multi-layer support' }
    case 'shp':
    case 'zip':
      return { supported: true, type: 'Shapefile', description: 'Include .shx, .dbf, .prj in ZIP' }
    case 'tif':
    case 'tiff':
    case 'geotiff':
      return { supported: true, type: 'GeoTIFF', description: 'Raster dataset' }
    case 'geojson':
    case 'json':
      return { supported: true, type: 'GeoJSON', description: 'Vector dataset' }
    case 'kml':
      return { supported: true, type: 'KML', description: 'Keyhole Markup Language' }
    case 'csv':
      return { supported: true, type: 'CSV', description: 'Requires coordinate columns' }
    default:
      return { supported: false, type: 'Unknown', description: 'File type may not be supported' }
  }
}

type UploadPhase = 'idle' | 'chunking' | 'finalizing' | 'done' | 'error' | 'cancelled'

export default function GeoNodeUploadDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const connectionId = dialogData?.data?.connectionId as string | undefined
  const connectionName = dialogData?.data?.connectionName as string | undefined
  const initialUploadType = (dialogData?.data?.uploadType as 'dataset' | 'document') || 'dataset'

  const [uploadType, setUploadType] = useState<'dataset' | 'document'>(initialUploadType)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [abstract, setAbstract] = useState('')
  const [fileInfo, setFileInfo] = useState<ReturnType<typeof getSupportedFileInfo> | null>(null)

  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [isPaused, setIsPaused] = useState(false)
  const [chunksUploaded, setChunksUploaded] = useState(0)
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunkProgress, setChunkProgress] = useState(0)
  const [speedBps, setSpeedBps] = useState(0)
  const [etaSeconds, setEtaSeconds] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  const sessionIdRef = useRef<string | null>(null)
  const isPausedRef = useRef(false)
  const isCancelledRef = useRef(false)

  const isOpen = activeDialog === 'geonodeupload'
  const dropzoneBg = useColorModeValue('gray.50', 'gray.700')
  const dropzoneBorderColor = useColorModeValue('gray.300', 'gray.600')

  const resetState = useCallback(() => {
    setUploadType(initialUploadType)
    setSelectedFile(null)
    setTitle('')
    setAbstract('')
    setFileInfo(null)
    setPhase('idle')
    setIsPaused(false)
    setChunksUploaded(0)
    setChunksTotal(0)
    setChunkProgress(0)
    setSpeedBps(0)
    setEtaSeconds(0)
    setErrorMsg('')
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
    if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ''))
    setFileInfo(getSupportedFileInfo(file.name))
  }, [title])

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
    if (!selectedFile || !connectionId) return

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
        '',
        '',
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
      await completeGeoNodeUpload(sessionId, connectionId, title || undefined, abstract || undefined, uploadType)

      setPhase('done')
      if (uploadType === 'document') {
        queryClient.invalidateQueries({ queryKey: ['geonodedocuments', connectionId] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['geonodedatasets', connectionId] })
      }
      queryClient.invalidateQueries({ queryKey: ['geonoderesources', connectionId] })
      toast({
        title: 'Upload successful',
        description: `Your ${uploadType} is being processed by GeoNode`,
        status: 'success',
        duration: 3000,
      })
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

  const overallPct = chunksTotal > 0 ? Math.round((chunksUploaded / chunksTotal) * 100) : 0
  const isUploading = phase === 'chunking' || phase === 'finalizing'

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        <Box
          bg="linear-gradient(135deg, #0d7377 0%, #14919b 50%, #2dc2c9 100%)"
          p={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={TbWorld} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">Upload to GeoNode</Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {connectionName || 'Upload geospatial data as datasets'}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={4}>
            {/* Type toggle */}
            {phase === 'idle' && (
              <ButtonGroup isAttached w="100%" size="sm">
                <Button
                  flex="1"
                  leftIcon={<FiLayers />}
                  colorScheme={uploadType === 'dataset' ? 'teal' : 'gray'}
                  variant={uploadType === 'dataset' ? 'solid' : 'outline'}
                  onClick={() => { setUploadType('dataset'); setSelectedFile(null); setFileInfo(null) }}
                >
                  Dataset
                </Button>
                <Button
                  flex="1"
                  leftIcon={<FiFileText />}
                  colorScheme={uploadType === 'document' ? 'teal' : 'gray'}
                  variant={uploadType === 'document' ? 'solid' : 'outline'}
                  onClick={() => { setUploadType('document'); setSelectedFile(null); setFileInfo(null) }}
                >
                  Document
                </Button>
              </ButtonGroup>
            )}

            {/* Dropzone */}
            {phase === 'idle' && (
              <FormControl>
                <FormLabel fontWeight="500">File</FormLabel>
                <Box
                  border="2px dashed"
                  borderColor={selectedFile ? 'teal.400' : dropzoneBorderColor}
                  borderRadius="lg"
                  p={6}
                  bg={selectedFile ? 'teal.50' : dropzoneBg}
                  textAlign="center"
                  cursor="pointer"
                  transition="all 0.2s"
                  _hover={{ borderColor: 'teal.400', bg: 'teal.50' }}
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    accept={
                      uploadType === 'document'
                        ? '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.mp4,.avi,.txt,.csv,.zip'
                        : '.gpkg,.shp,.zip,.tif,.tiff,.geotiff,.geojson,.json,.kml,.csv'
                    }
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSelect(file)
                    }}
                  />
                  {selectedFile ? (
                    <VStack spacing={2}>
                      <Icon as={FiFile} boxSize={8} color="teal.500" />
                      <Text fontWeight="500">{selectedFile.name}</Text>
                      <Text fontSize="sm" color="gray.500">{formatFileSize(selectedFile.size)}</Text>
                      {fileInfo && (
                        <Badge colorScheme={fileInfo.supported ? 'teal' : 'orange'}>{fileInfo.type}</Badge>
                      )}
                      {fileInfo && <Text fontSize="xs" color="gray.500">{fileInfo.description}</Text>}
                    </VStack>
                  ) : (
                    <VStack spacing={2}>
                      <Icon as={FiUpload} boxSize={8} color="gray.400" />
                      <Text color="gray.600">Drop a file here or click to browse</Text>
                      <Text fontSize="sm" color="gray.500">
                        {uploadType === 'document'
                          ? 'Supports PDF, Word, Excel, images, and more'
                          : 'Supports GeoPackage, Shapefile, GeoTIFF, GeoJSON, KML'}
                      </Text>
                    </VStack>
                  )}
                </Box>
              </FormControl>
            )}

            {/* Title & Abstract — only when idle */}
            {phase === 'idle' && (
              <>
                <FormControl>
                  <FormLabel fontWeight="500">Title (optional)</FormLabel>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Dataset title"
                    borderRadius="lg"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel fontWeight="500">Abstract (optional)</FormLabel>
                  <Textarea
                    value={abstract}
                    onChange={(e) => setAbstract(e.target.value)}
                    placeholder="Brief description of the dataset"
                    borderRadius="lg"
                    rows={3}
                  />
                </FormControl>
              </>
            )}

            {/* Uploading: file info + progress */}
            {(isUploading || phase === 'done' || phase === 'cancelled') && selectedFile && (
              <Box
                w="100%"
                p={4}
                bg={dropzoneBg}
                borderRadius="lg"
                border="1px solid"
                borderColor={
                  phase === 'done' ? 'green.200' :
                  phase === 'cancelled' ? 'orange.200' : 'gray.200'
                }
              >
                <VStack align="stretch" spacing={3}>
                  <HStack>
                    <Icon as={FiFile} color="teal.500" />
                    <Text fontWeight="500" flex="1" noOfLines={1}>{selectedFile.name}</Text>
                    <Text fontSize="sm" color="gray.500">{formatFileSize(selectedFile.size)}</Text>
                  </HStack>

                  {/* Chunk progress */}
                  {phase === 'chunking' && chunksTotal > 0 && (
                    <>
                      <Box>
                        <HStack justify="space-between" mb={1}>
                          <Text fontSize="xs" color="gray.500">
                            {chunksTotal > 1
                              ? `Chunks: ${chunksUploaded}/${chunksTotal}`
                              : 'Uploading…'}
                          </Text>
                          <HStack spacing={3}>
                            {speedBps > 0 && (
                              <Text fontSize="xs" color="gray.500">{formatSpeed(speedBps)}</Text>
                            )}
                            {etaSeconds > 0 && (
                              <Text fontSize="xs" color="gray.500">ETA: {formatEta(etaSeconds)}</Text>
                            )}
                          </HStack>
                        </HStack>
                        <Progress
                          value={overallPct}
                          size="sm"
                          colorScheme={isPaused ? 'yellow' : 'teal'}
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
                          <Button size="xs" variant="outline" colorScheme="yellow" onClick={handlePause} leftIcon={<FiPause />}>
                            Pause
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" colorScheme="green" onClick={handleResume} leftIcon={<FiPlay />}>
                            Resume
                          </Button>
                        )}
                        <Button size="xs" variant="ghost" colorScheme="red" onClick={handleCancel}>
                          Cancel
                        </Button>
                      </HStack>
                    </>
                  )}

                  {/* Finalizing */}
                  {phase === 'finalizing' && (
                    <Box>
                      <Text fontSize="xs" color="blue.500" fontWeight="500" mb={1}>
                        Sending to GeoNode…
                      </Text>
                      <Progress isIndeterminate size="sm" colorScheme="blue" borderRadius="full" />
                    </Box>
                  )}

                  {phase === 'done' && (
                    <Text fontSize="sm" color="green.600" fontWeight="500">Upload complete</Text>
                  )}
                  {phase === 'cancelled' && (
                    <Text fontSize="sm" color="orange.500">Upload cancelled</Text>
                  )}
                </VStack>
              </Box>
            )}

            {/* Error */}
            {phase === 'error' && (
              <Alert status="error" borderRadius="lg" variant="subtle">
                <AlertIcon as={FiAlertCircle} />
                <Text fontSize="sm">{errorMsg}</Text>
              </Alert>
            )}

            {/* Success */}
            {phase === 'done' && (
              <Alert status="success" borderRadius="lg" variant="subtle">
                <AlertIcon as={FiCheckCircle} />
                <Text fontSize="sm">
                  Dataset uploaded successfully. GeoNode is processing your file.
                </Text>
              </Alert>
            )}
          </VStack>
        </ModalBody>

        <ModalFooter gap={3} borderTop="1px solid" borderTopColor="gray.100" bg="gray.50">
          <Button variant="ghost" onClick={closeDialog} borderRadius="lg">
            {phase === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {phase !== 'done' && (
            <Button
              colorScheme="teal"
              onClick={handleUpload}
              isLoading={isUploading}
              loadingText={phase === 'finalizing' ? 'Finalizing…' : 'Uploading…'}
              isDisabled={!selectedFile || isUploading}
              borderRadius="lg"
              px={6}
              leftIcon={<FiUpload />}
            >
              Upload
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
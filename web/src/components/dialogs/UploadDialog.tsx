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
  Input,
  FormControl,
  FormLabel,
} from '@chakra-ui/react'
import { FiFile, FiUploadCloud, FiLayers, FiCheckCircle, FiUpload } from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import { useTreeStore } from '../../stores/treeStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { cancelRelayUpload, relayUpload } from '../../api/relayUpload'

interface GeoServerUploadResult {
  label: string
  storeName?: string
  storeType?: string
}

type UploadPhase = 'idle' | 'chunking' | 'finalizing' | 'done' | 'error' | 'cancelled'

// Shown while a failed chunk waits to be sent again.
interface RetryNotice {
  attempt: number
  delaySeconds: number
}

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
  const [retry, setRetry] = useState<RetryNotice | null>(null)
  const [chunksUploaded, setChunksUploaded] = useState(0)
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunkProgress, setChunkProgress] = useState(0)
  const [speedBps, setSpeedBps] = useState(0)
  const [etaSeconds, setEtaSeconds] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [uploadResult, setUploadResult] = useState<GeoServerUploadResult | null>(null)

  const sessionIdRef = useRef<string | null>(null)
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
    setRetry(null)
    setChunksUploaded(0)
    setChunksTotal(0)
    setChunkProgress(0)
    setSpeedBps(0)
    setEtaSeconds(0)
    setErrorMsg('')
    setUploadResult(null)
    sessionIdRef.current = null
    isCancelledRef.current = false
  }, [])

  useEffect(() => {
    if (isOpen) resetState()
  }, [isOpen, resetState])

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file)
    setPhase('idle')
    setErrorMsg('')
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

  const handleUpload = async () => {
    if (!selectedFile || !connectionId || !workspace) return

    isCancelledRef.current = false
    setPhase('chunking')
    setRetry(null)
    setChunksUploaded(0)
    setChunkProgress(0)
    setSpeedBps(0)
    setEtaSeconds(0)

    const totalBytes = selectedFile.size
    const startTime = Date.now()

    try {
      // Straight to GeoServer as it's sent: nothing is stored on CloudBench.
      const status = await relayUpload(
        selectedFile,
        { target: 'geoserver', connectionId, workspace, storeName },
        {
          onStarted: ({ sessionId, totalChunks }) => {
            sessionIdRef.current = sessionId
            setChunksTotal(totalChunks)
          },
          onChunkProgress: (pct) => setChunkProgress(pct),
          onChunkSent: (sentChunks, sentBytes) => {
            const elapsedSec = (Date.now() - startTime) / 1000
            const speed = elapsedSec > 0 ? sentBytes / elapsedSec : 0
            setRetry(null)
            setChunksUploaded(sentChunks)
            setChunkProgress(100)
            setSpeedBps(speed)
            setEtaSeconds(speed > 0 ? (totalBytes - sentBytes) / speed : 0)
            if (sentBytes >= totalBytes) setPhase('finalizing')
          },
          onRetry: (attempt, delaySeconds) => setRetry({ attempt, delaySeconds }),
          isCancelled: () => isCancelledRef.current,
        },
      )
      if (!status || status.state === 'cancelled') {
        setPhase('cancelled')
        return
      }
      const result = status.result ?? {}
      setUploadResult({
        label: selectedFile.name,
        storeName: result.storeName as string | undefined,
        storeType: result.storeType as string | undefined,
      })
      setPhase('done')
      queryClient.invalidateQueries({ queryKey: ['datastores', connectionId, workspace] })
      queryClient.invalidateQueries({ queryKey: ['coveragestores', connectionId, workspace] })
      queryClient.invalidateQueries({ queryKey: ['layers', connectionId, workspace] })
    } catch (err) {
      if (!isCancelledRef.current) {
        const msg = (err as Error).message
        setErrorMsg(msg)
        setPhase('error')
        toast({ title: 'Upload failed', description: msg, status: 'error', duration: 5000 })
      }
    } finally {
      setRetry(null)
    }
  }

  const handleCancel = async () => {
    isCancelledRef.current = true
    const sessId = sessionIdRef.current
    if (sessId) await cancelRelayUpload(sessId)
    setPhase('cancelled')
  }

  const handleClose = () => {
    resetState()
    closeDialog()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="85vh">
        <Box bg="surface.header" px={6} py={4}>
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
            {selectedFile && (phase === 'idle' || phase === 'cancelled' || phase === 'error') && (
              <FormControl>
                <FormLabel fontSize="sm">Store Name</FormLabel>
                <Input
                  size="sm"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. my_store"
                />
              </FormControl>
            )}

            {/* Upload progress */}
            {isUploading && selectedFile && (
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
                          colorScheme={retry ? 'yellow' : 'kartoza'}
                          borderRadius="sm"
                          hasStripe
                          isAnimated
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
                            borderRadius="sm"
                            opacity={0.7}
                          />
                        </Box>
                      )}
                      {retry && (
                        <Text fontSize="xs" color="orange.500">
                          Connection lost — retrying in {retry.delaySeconds}s (attempt {retry.attempt})
                        </Text>
                      )}
                      <HStack spacing={2} justify="flex-end">
                        <Button size="xs" variant="ghost" colorScheme="red" onClick={handleCancel}>
                          Cancel
                        </Button>
                      </HStack>
                    </>
                  )}

                  {phase === 'finalizing' && (
                    <Box>
                      <Text fontSize="xs" color="blue.500" fontWeight="500" mb={1}>
                        Waiting for GeoServer to create the store…
                      </Text>
                      <Progress isIndeterminate size="sm" colorScheme="blue" borderRadius="sm" />
                    </Box>
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
                    borderColor="green.200"
                  >
                    <HStack justify="space-between">
                      <HStack spacing={2} flex="1" minW={0}>
                        <Icon as={FiCheckCircle} color="green.500" flexShrink={0} />
                        <Text fontSize="sm" fontWeight="500" noOfLines={1}>{uploadResult.label}</Text>
                        {uploadResult.storeType && (
                          <Badge colorScheme="blue" fontSize="xs">{uploadResult.storeType}</Badge>
                        )}
                      </HStack>
                      <Badge colorScheme="green" flexShrink={0}>
                        completed
                      </Badge>
                    </HStack>
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
              loadingText={phase === 'finalizing' ? 'Creating store…' : 'Uploading…'}
              borderRadius="lg"
              px={6}
            >
              Upload
            </Button>
          )}

        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

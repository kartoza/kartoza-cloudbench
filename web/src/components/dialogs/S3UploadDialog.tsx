import { useState, useEffect, useRef, useCallback } from 'react'
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
  VStack,
  HStack,
  Text,
  Icon,
  Box,
  useToast,
  Progress,
  Select,
  Switch,
  Badge,
  Alert,
  AlertIcon,
  useColorModeValue,
} from '@chakra-ui/react'
import { FiUpload, FiFile, FiCheckCircle, FiAlertCircle, FiRefreshCw } from 'react-icons/fi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Helper to detect recommended conversion
function detectRecommendedConversion(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  // Raster formats -> COG
  if (['tif', 'tiff', 'geotiff', 'png', 'jpg', 'jpeg', 'jp2', 'ecw', 'img'].includes(ext)) {
    return 'cog'
  }
  // Point cloud formats -> COPC
  if (['las', 'laz', 'e57', 'ply', 'xyz'].includes(ext)) {
    return 'copc'
  }
  // Vector formats -> GeoParquet
  if (['shp', 'gpkg', 'geojson', 'json', 'kml', 'gml', 'csv'].includes(ext)) {
    return 'geoparquet'
  }
  return null
}

export default function S3UploadDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Dialog data
  const connectionId = dialogData?.data?.connectionId as string | undefined
  const bucketName = dialogData?.data?.bucketName as string | undefined

  // Form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [companionFiles, setCompanionFiles] = useState<File[]>([])
  const [customKey, setCustomKey] = useState('')
  const [selectedBucket, setSelectedBucket] = useState(bucketName || '')
  const [convertToCloudNative, setConvertToCloudNative] = useState(true)
  const [targetFormat, setTargetFormat] = useState<string>('')
  const [recommendedFormat, setRecommendedFormat] = useState<string | null>(null)
  const [createSubfolder, setCreateSubfolder] = useState(true) // For GeoPackage layer extraction
  const [isGeoPackage, setIsGeoPackage] = useState(false)

  // Upload state
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string; conversionJobId?: string } | null>(null)
  const [conversionJobId, setConversionJobId] = useState<string | null>(null)

  const isOpen = activeDialog === 's3upload'
  const isShapefile = !!selectedFile && /\.(shp|zip)$/i.test(selectedFile.name)
  const dropzoneBg = useColorModeValue('gray.50', 'gray.700')
  const dropzoneBorderColor = useColorModeValue('gray.300', 'gray.600')

  // Fetch buckets for the connection
  const { data: buckets } = useQuery({
    queryKey: ['s3buckets', connectionId],
    queryFn: () => connectionId ? api.getS3Buckets(connectionId) : Promise.resolve([]),
    enabled: isOpen && !!connectionId,
  })

  // Fetch conversion tools status
  const { data: toolStatus } = useQuery({
    queryKey: ['conversionTools'],
    queryFn: () => api.getConversionToolStatus(),
    enabled: isOpen,
  })
  const showPMTiles = isShapefile && !!toolStatus?.cloudnativegis?.available

  // Poll for conversion job status
  const { data: conversionJob, error: conversionJobError } = useQuery({
    queryKey: ['conversionJob', conversionJobId],
    queryFn: () => conversionJobId ? api.getConversionJob(conversionJobId) : null,
    enabled: !!conversionJobId,
    refetchInterval: (query) => {
      const job = query.state.data
      return job && ['completed', 'failed', 'cancelled'].includes(job.status) ? false : 2000
    },
  })
  const isConverting = !!conversionJobId &&
    (!conversionJob || ['pending', 'running'].includes(conversionJob.status))

  useEffect(() => {
    if (conversionJob?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId, selectedBucket] })
    }
  }, [conversionJob?.status, connectionId, selectedBucket, queryClient])

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null)
      setCompanionFiles([])
      setCustomKey('')
      setSelectedBucket(bucketName || '')
      setConvertToCloudNative(true)
      setTargetFormat('')
      setRecommendedFormat(null)
      setUploadProgress(0)
      setUploadResult(null)
      setConversionJobId(null)
      setCreateSubfolder(true)
      setIsGeoPackage(false)
    }
  }, [isOpen, bucketName])

  // Update recommended format when file changes
  useEffect(() => {
    if (selectedFile) {
      const recommended = showPMTiles ? 'pmtiles' : detectRecommendedConversion(selectedFile.name)
      setRecommendedFormat(recommended)
      setTargetFormat(recommended || '')
      // Detect if it's a GeoPackage
      const ext = selectedFile.name.split('.').pop()?.toLowerCase()
      setIsGeoPackage(ext === 'gpkg')
    }
  }, [selectedFile, showPMTiles])

  const handleFileSelect = useCallback((files: File[]) => {
    if (isUploading || isConverting) return
    const file = files.find((component) => /\.shp$/i.test(component.name)) || files[0]
    if (!file) return
    if (files.length > 1 && !/\.shp$/i.test(file.name)) {
      toast({ title: 'Select one file, or the components of one shapefile', status: 'warning' })
      return
    }
    setSelectedFile(file)
    setCompanionFiles(files.filter((component) => component !== file))
    setUploadResult(null)
    // Set custom key to filename by default
    setCustomKey(file.name)
  }, [isUploading, isConverting, toast])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileSelect(Array.from(e.dataTransfer.files))
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleUpload = async () => {
    if (isUploading || isConverting) return
    if (!selectedFile || !connectionId || !selectedBucket) {
      toast({
        title: 'Missing required fields',
        description: 'Please select a file and bucket',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsUploading(true)
    setUploadProgress(0)
    setUploadResult(null)

    try {
      const result = await api.uploadToS3(
        connectionId,
        selectedBucket,
        selectedFile,
        customKey || undefined,
        convertToCloudNative && !!targetFormat,
        convertToCloudNative ? targetFormat || undefined : undefined,
        (progress) => setUploadProgress(progress),
        isGeoPackage ? createSubfolder : undefined,
        undefined,
        companionFiles
      )

      setUploadResult({
        success: result.success,
        message: result.message,
        conversionJobId: result.conversionJobId,
      })

      if (result.conversionJobId) {
        setConversionJobId(result.conversionJobId)
      }

      // Refresh object list
      queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId, selectedBucket] })

      toast({
        title: result.conversionJobId ? 'Conversion started' : 'Upload successful',
        description: result.message,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      setUploadResult({
        success: false,
        message: (err as Error).message,
      })
      toast({
        title: 'Upload failed',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsUploading(false)
    }
  }

  const canConvert = (format: string): boolean => {
    if (!toolStatus) return false
    switch (format) {
      case 'cog':
        return toolStatus.gdal?.available || false
      case 'copc':
        return toolStatus.pdal?.available || false
      case 'geoparquet':
        return toolStatus.ogr2ogr?.available || false
      case 'pmtiles':
        return showPMTiles
      default:
        return false
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="3xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="90vh">
        {/* Gradient Header */}
        <Box
          bg="linear-gradient(135deg, #c06c00 0%, #e08900 50%, #f0a020 100%)"
          p={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiUpload} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Upload to S3
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                Upload files with optional cloud-native conversion
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={4} overflowY="auto">
          {/* Two-column layout for file selection and options */}
          <HStack spacing={4} align="stretch">
            {/* Left column: File selection */}
            <VStack spacing={3} flex="1" align="stretch">
              {/* Bucket Selection */}
              <FormControl isRequired size="sm">
                <FormLabel fontWeight="500" color="gray.700" fontSize="sm">Target Bucket</FormLabel>
                <Select
                  value={selectedBucket}
                  isDisabled={isUploading || isConverting}
                  onChange={(e) => setSelectedBucket(e.target.value)}
                  placeholder="Select a bucket"
                  size="sm"
                  borderRadius="lg"
                >
                  {buckets?.map((bucket) => (
                    <option key={bucket.name} value={bucket.name}>
                      {bucket.name}
                    </option>
                  ))}
                </Select>
              </FormControl>

              {/* File Drop Zone */}
              <FormControl flex="1">
                <FormLabel fontWeight="500" color="gray.700" fontSize="sm">File</FormLabel>
                <Box
                  border="2px dashed"
                  borderColor={selectedFile ? 'orange.400' : dropzoneBorderColor}
                  borderRadius="lg"
                  p={4}
                  bg={selectedFile ? 'orange.50' : dropzoneBg}
                  textAlign="center"
                  cursor="pointer"
                  transition="all 0.2s"
                  _hover={{ borderColor: 'orange.400', bg: 'orange.50' }}
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  minH="120px"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      handleFileSelect(Array.from(e.target.files || []))
                      e.target.value = ''
                    }}
                  />
                  {selectedFile ? (
                    <VStack spacing={1}>
                      <Icon as={FiFile} boxSize={6} color="orange.500" />
                      <Text fontWeight="500" color="gray.700" fontSize="sm" noOfLines={1}>{selectedFile.name}</Text>
                      <Text fontSize="xs" color="gray.500">
                        {formatFileSize(selectedFile.size + companionFiles.reduce((total, file) => total + file.size, 0))}
                      </Text>
                      {companionFiles.length > 0 && (
                        <Text fontSize="xs" color="gray.600">
                          Also selected: {companionFiles.map((file) => file.name).join(', ')}
                        </Text>
                      )}
                      {recommendedFormat && (
                        <Badge colorScheme="orange" fontSize="xs">
                          → {recommendedFormat.toUpperCase()}
                        </Badge>
                      )}
                    </VStack>
                  ) : (
                    <VStack spacing={1}>
                      <Icon as={FiUpload} boxSize={6} color="gray.400" />
                      <Text color="gray.600" fontSize="sm">
                        Drop file or click to browse
                      </Text>
                      <Text fontSize="xs" color="gray.500">
                        GeoTIFF, Shapefile, LAS, GeoPackage...
                      </Text>
                    </VStack>
                  )}
                </Box>
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Select .shp, .shx and .dbf together (plus .prj if available).
                  Cloudbench will ZIP them automatically.
                </Text>
              </FormControl>

              {/* Object Key (path) */}
              <FormControl>
                <FormLabel fontWeight="500" color="gray.700" fontSize="sm">Object Key (optional)</FormLabel>
                <Input
                  value={customKey}
                  isDisabled={isUploading || isConverting}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="path/to/file.tif"
                  size="sm"
                  borderRadius="lg"
                />
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Leave empty to use original filename
                </Text>
              </FormControl>
            </VStack>

            {/* Right column: Conversion options */}
            <VStack spacing={3} flex="1" align="stretch">
              {/* Cloud-Native Conversion Options */}
              {recommendedFormat || showPMTiles ? (
                <Box p={3} bg="orange.50" borderRadius="lg" border="1px solid" borderColor="orange.200" h="100%">
                  <HStack justify="space-between" mb={2}>
                    <Text fontWeight="500" color="gray.700" fontSize="sm">Convert to Cloud-Native</Text>
                    <Switch
                      isChecked={convertToCloudNative}
                      isDisabled={isUploading || isConverting}
                      onChange={(e) => setConvertToCloudNative(e.target.checked)}
                      colorScheme="orange"
                      size="sm"
                    />
                  </HStack>

                  {convertToCloudNative && (
                    <VStack spacing={2} align="stretch">
                      <Select
                        value={targetFormat}
                        isDisabled={isUploading || isConverting}
                        onChange={(e) => setTargetFormat(e.target.value)}
                        placeholder="Select a format"
                        size="sm"
                        borderRadius="lg"
                      >
                        <option value="cog" disabled={!canConvert('cog')}>
                          COG {!canConvert('cog') && '- unavailable'}
                        </option>
                        <option value="copc" disabled={!canConvert('copc')}>
                          COPC {!canConvert('copc') && '- unavailable'}
                        </option>
                        <option value="geoparquet" disabled={!canConvert('geoparquet')}>
                          GeoParquet {!canConvert('geoparquet') && '- unavailable'}
                        </option>
                        {showPMTiles && (
                          <option value="pmtiles">
                            PMTiles
                          </option>
                        )}
                      </Select>

                      {/* GeoPackage-specific options */}
                      {isGeoPackage && targetFormat === 'geoparquet' && (
                        <Box p={2} bg="blue.50" borderRadius="md" border="1px solid" borderColor="blue.200">
                          <Text fontSize="xs" color="blue.700" fontWeight="500" mb={1}>
                            GeoPackage Layer Extraction
                          </Text>
                          <Text fontSize="xs" color="gray.600" mb={2}>
                            All layers extracted as separate GeoParquet/Parquet files.
                          </Text>
                          <HStack justify="space-between">
                            <Text fontSize="xs" color="gray.700">Create subfolder</Text>
                            <Switch
                              isChecked={createSubfolder}
                              onChange={(e) => setCreateSubfolder(e.target.checked)}
                              colorScheme="blue"
                              size="sm"
                            />
                          </HStack>
                        </Box>
                      )}

                      {targetFormat && !canConvert(targetFormat) && (
                        <Alert status="warning" size="sm" borderRadius="md" py={1} px={2}>
                          <AlertIcon boxSize={3} />
                          <Text fontSize="xs">
                            Tool not available. Upload without conversion.
                          </Text>
                        </Alert>
                      )}
                    </VStack>
                  )}
                </Box>
              ) : (
                <Box p={3} bg="gray.50" borderRadius="lg" border="1px solid" borderColor="gray.200" h="100%">
                  <Text fontSize="sm" color="gray.500" textAlign="center">
                    Select a file to see conversion options
                  </Text>
                </Box>
              )}
            </VStack>
          </HStack>

          {/* Status section - below the two columns */}
          <VStack spacing={2} mt={4} align="stretch">
            {/* Upload Progress */}
            {isUploading && (
              <Box w="100%">
                <HStack justify="space-between" mb={1}>
                  <Text fontSize="xs" color="gray.600">Uploading...</Text>
                  <Text fontSize="xs" color="gray.600">{uploadProgress}%</Text>
                </HStack>
                <Progress
                  value={uploadProgress}
                  size="xs"
                  colorScheme="orange"
                  borderRadius="full"
                  hasStripe
                  isAnimated
                />
              </Box>
            )}

            {/* Conversion Job Progress */}
            {conversionJob && ['pending', 'running'].includes(conversionJob.status) && (
              <Box w="100%" p={2} bg="blue.50" borderRadius="lg">
                <HStack mb={1}>
                  <Icon as={FiRefreshCw} className="spin" color="blue.500" boxSize={3} />
                  <Text fontWeight="500" color="blue.700" fontSize="xs">Converting...</Text>
                </HStack>
                <Progress
                  value={conversionJob.progress}
                  size="xs"
                  colorScheme="blue"
                  borderRadius="full"
                  hasStripe
                  isAnimated
                />
                <Text fontSize="xs" color="gray.600" mt={1}>
                  {conversionJob.message}
                </Text>
              </Box>
            )}

            {/* Upload/Conversion Result */}
            <AnimatePresence>
              {conversionJobError && (
                <Alert status="error" borderRadius="lg">
                  <AlertIcon />
                  <Text fontSize="xs">Unable to check conversion status: {(conversionJobError as Error).message}</Text>
                </Alert>
              )}
              {uploadResult && !conversionJob && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{ width: '100%' }}
                >
                  <Alert
                    status={uploadResult.success ? 'success' : 'error'}
                    borderRadius="lg"
                    variant="subtle"
                    py={2}
                  >
                    <AlertIcon as={uploadResult.success ? FiCheckCircle : FiAlertCircle} boxSize={4} />
                    <Text fontSize="xs">{uploadResult.message}</Text>
                  </Alert>
                </motion.div>
              )}

              {conversionJob && conversionJob.status === 'completed' && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{ width: '100%' }}
                >
                  <Alert status="success" borderRadius="lg" variant="subtle" py={2}>
                    <AlertIcon as={FiCheckCircle} boxSize={4} />
                    <Box>
                      <Text fontSize="xs" fontWeight="500">Conversion Complete</Text>
                      <Text fontSize="xs" color="gray.600">
                        Output: {conversionJob.outputPath}
                      </Text>
                    </Box>
                  </Alert>
                </motion.div>
              )}

              {conversionJob && conversionJob.status === 'failed' && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{ width: '100%' }}
                >
                  <Alert status="error" borderRadius="lg" variant="subtle" py={2}>
                    <AlertIcon as={FiAlertCircle} boxSize={4} />
                    <Box>
                      <Text fontSize="xs" fontWeight="500">Conversion Failed</Text>
                      <Text fontSize="xs" color="gray.600">
                        {conversionJob.error}
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
          <Button variant="ghost" onClick={closeDialog} borderRadius="lg">
            {uploadResult?.success ? 'Close' : 'Cancel'}
          </Button>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              colorScheme="orange"
              onClick={handleUpload}
              isLoading={isUploading || isConverting}
              loadingText={isConverting ? 'Converting...' : 'Uploading...'}
              isDisabled={!selectedFile || !selectedBucket || (convertToCloudNative && targetFormat === 'pmtiles' && !showPMTiles)}
              borderRadius="lg"
              px={6}
              leftIcon={<FiUpload />}
            >
              Upload
            </Button>
          </motion.div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

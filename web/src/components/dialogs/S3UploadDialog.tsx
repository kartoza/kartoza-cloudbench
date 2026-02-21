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
import * as api from '../../api/client'

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

  // Poll for conversion job status
  const { data: conversionJob } = useQuery({
    queryKey: ['conversionJob', conversionJobId],
    queryFn: () => conversionJobId ? api.getConversionJob(conversionJobId) : null,
    enabled: !!conversionJobId,
    refetchInterval: conversionJobId ? 2000 : false,
  })

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null)
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
      const recommended = detectRecommendedConversion(selectedFile.name)
      setRecommendedFormat(recommended)
      setTargetFormat(recommended || '')
      // Detect if it's a GeoPackage
      const ext = selectedFile.name.split('.').pop()?.toLowerCase()
      setIsGeoPackage(ext === 'gpkg')
    }
  }, [selectedFile])

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file)
    setUploadResult(null)
    // Set custom key to filename by default
    setCustomKey(file.name)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleUpload = async () => {
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
        targetFormat || undefined,
        (progress) => setUploadProgress(progress),
        isGeoPackage ? createSubfolder : undefined,
        undefined // prefix would come from current folder context if needed
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
        title: 'Upload successful',
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
      default:
        return false
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
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

        <ModalBody py={6}>
          <VStack spacing={4}>
            {/* Bucket Selection */}
            <FormControl isRequired>
              <FormLabel fontWeight="500" color="gray.700">Target Bucket</FormLabel>
              <Select
                value={selectedBucket}
                onChange={(e) => setSelectedBucket(e.target.value)}
                placeholder="Select a bucket"
                size="lg"
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
            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">File</FormLabel>
              <Box
                border="2px dashed"
                borderColor={selectedFile ? 'orange.400' : dropzoneBorderColor}
                borderRadius="lg"
                p={6}
                bg={selectedFile ? 'orange.50' : dropzoneBg}
                textAlign="center"
                cursor="pointer"
                transition="all 0.2s"
                _hover={{ borderColor: 'orange.400', bg: 'orange.50' }}
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileSelect(file)
                  }}
                />
                {selectedFile ? (
                  <VStack spacing={2}>
                    <Icon as={FiFile} boxSize={8} color="orange.500" />
                    <Text fontWeight="500" color="gray.700">{selectedFile.name}</Text>
                    <Text fontSize="sm" color="gray.500">{formatFileSize(selectedFile.size)}</Text>
                    {recommendedFormat && (
                      <Badge colorScheme="orange">
                        Recommended: Convert to {recommendedFormat.toUpperCase()}
                      </Badge>
                    )}
                  </VStack>
                ) : (
                  <VStack spacing={2}>
                    <Icon as={FiUpload} boxSize={8} color="gray.400" />
                    <Text color="gray.600">
                      Drop a file here or click to browse
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      Supports geospatial formats (GeoTIFF, Shapefile, LAS, etc.)
                    </Text>
                  </VStack>
                )}
              </Box>
            </FormControl>

            {/* Object Key (path) */}
            <FormControl>
              <FormLabel fontWeight="500" color="gray.700">Object Key (optional)</FormLabel>
              <Input
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder="path/to/file.tif"
                size="lg"
                borderRadius="lg"
              />
              <Text fontSize="xs" color="gray.500" mt={1}>
                Leave empty to use the original filename
              </Text>
            </FormControl>

            {/* Cloud-Native Conversion Options */}
            {recommendedFormat && (
              <Box w="100%" p={4} bg="orange.50" borderRadius="lg" border="1px solid" borderColor="orange.200">
                <HStack justify="space-between" mb={3}>
                  <Text fontWeight="500" color="gray.700">Convert to Cloud-Native Format</Text>
                  <Switch
                    isChecked={convertToCloudNative}
                    onChange={(e) => setConvertToCloudNative(e.target.checked)}
                    colorScheme="orange"
                  />
                </HStack>

                {convertToCloudNative && (
                  <VStack spacing={3} align="stretch">
                    <Select
                      value={targetFormat}
                      onChange={(e) => setTargetFormat(e.target.value)}
                      size="md"
                      borderRadius="lg"
                    >
                      <option value="cog" disabled={!canConvert('cog')}>
                        COG (Cloud Optimized GeoTIFF) {!canConvert('cog') && '- GDAL not available'}
                      </option>
                      <option value="copc" disabled={!canConvert('copc')}>
                        COPC (Cloud Optimized Point Cloud) {!canConvert('copc') && '- PDAL not available'}
                      </option>
                      <option value="geoparquet" disabled={!canConvert('geoparquet')}>
                        GeoParquet {!canConvert('geoparquet') && '- ogr2ogr not available'}
                      </option>
                    </Select>

                    {/* GeoPackage-specific options */}
                    {isGeoPackage && targetFormat === 'geoparquet' && (
                      <Box p={3} bg="blue.50" borderRadius="md" border="1px solid" borderColor="blue.200">
                        <VStack align="stretch" spacing={2}>
                          <Text fontSize="sm" color="blue.700" fontWeight="500">
                            GeoPackage Layer Extraction
                          </Text>
                          <Text fontSize="xs" color="gray.600">
                            All layers in the GeoPackage will be extracted as separate GeoParquet files.
                          </Text>
                          <HStack justify="space-between">
                            <Text fontSize="sm" color="gray.700">Create subfolder for layers</Text>
                            <Switch
                              isChecked={createSubfolder}
                              onChange={(e) => setCreateSubfolder(e.target.checked)}
                              colorScheme="blue"
                              size="sm"
                            />
                          </HStack>
                          <Text fontSize="xs" color="gray.500">
                            {createSubfolder
                              ? 'Layers will be placed in a folder named after the GeoPackage'
                              : 'Layers will be placed directly in the current folder'}
                          </Text>
                        </VStack>
                      </Box>
                    )}

                    {!canConvert(targetFormat) && (
                      <Alert status="warning" size="sm" borderRadius="md">
                        <AlertIcon />
                        <Text fontSize="sm">
                          Required tool not available. The file will be uploaded without conversion.
                        </Text>
                      </Alert>
                    )}
                  </VStack>
                )}
              </Box>
            )}

            {/* Upload Progress */}
            {isUploading && (
              <Box w="100%">
                <HStack justify="space-between" mb={2}>
                  <Text fontSize="sm" color="gray.600">Uploading...</Text>
                  <Text fontSize="sm" color="gray.600">{uploadProgress}%</Text>
                </HStack>
                <Progress
                  value={uploadProgress}
                  size="sm"
                  colorScheme="orange"
                  borderRadius="full"
                  hasStripe
                  isAnimated
                />
              </Box>
            )}

            {/* Conversion Job Progress */}
            {conversionJob && conversionJob.status === 'running' && (
              <Box w="100%" p={4} bg="blue.50" borderRadius="lg">
                <HStack mb={2}>
                  <Icon as={FiRefreshCw} className="spin" color="blue.500" />
                  <Text fontWeight="500" color="blue.700">Converting...</Text>
                </HStack>
                <Progress
                  value={conversionJob.progress}
                  size="sm"
                  colorScheme="blue"
                  borderRadius="full"
                  hasStripe
                  isAnimated
                />
                <Text fontSize="sm" color="gray.600" mt={2}>
                  {conversionJob.message}
                </Text>
              </Box>
            )}

            {/* Upload/Conversion Result */}
            <AnimatePresence>
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
                  >
                    <AlertIcon as={uploadResult.success ? FiCheckCircle : FiAlertCircle} />
                    <Text fontSize="sm">{uploadResult.message}</Text>
                  </Alert>
                </motion.div>
              )}

              {conversionJob && conversionJob.status === 'completed' && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{ width: '100%' }}
                >
                  <Alert status="success" borderRadius="lg" variant="subtle">
                    <AlertIcon as={FiCheckCircle} />
                    <Box>
                      <Text fontSize="sm" fontWeight="500">Conversion Complete</Text>
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
                  <Alert status="error" borderRadius="lg" variant="subtle">
                    <AlertIcon as={FiAlertCircle} />
                    <Box>
                      <Text fontSize="sm" fontWeight="500">Conversion Failed</Text>
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
              isLoading={isUploading}
              isDisabled={!selectedFile || !selectedBucket}
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

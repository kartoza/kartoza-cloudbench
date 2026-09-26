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
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Checkbox,
  Spinner,
  Center,
} from '@chakra-ui/react'
import { FiUpload, FiFile, FiCheckCircle, FiAlertCircle, FiRefreshCw, FiCircle } from 'react-icons/fi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import type { ConversionJob } from '../../types'

// Mirrors apps.s3.portolan.LICENSE_CHOICES — keep in sync. ("proprietary"
// isn't offered: the Portolan spec forbids it — use "other" with a URL.)
const LICENSE_CHOICES = [
  { id: 'other', label: 'Other / not specified' },
  { id: 'CC0-1.0', label: 'CC0 1.0 (Public Domain)' },
  { id: 'CC-BY-4.0', label: 'CC BY 4.0' },
  { id: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0' },
  { id: 'ODbL-1.0', label: 'ODbL 1.0' },
]

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

interface LayerProgressStatus {
  name: string
  status: 'done' | 'active' | 'pending'
}

// Derives a per-layer done/active/pending breakdown from the job's coarse
// 20-80% "converting" progress window and cng-lite's processing order
// (job.layers), so the picked GeoPackage layers show individual progress
// instead of one opaque bar.
function layerConversionStatuses(job: ConversionJob): LayerProgressStatus[] | null {
  const layers = job.layers
  if (!layers || layers.length === 0) return null

  const fraction = Math.min(1, Math.max(0, (job.progress - 20) / 60))
  const activeIndex = Math.floor(fraction * layers.length)
  const allDone = job.status === 'completed' || activeIndex >= layers.length

  return layers.map((name, index) => ({
    name,
    status: allDone || index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  }))
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
  // The folder the user was browsing when they clicked Upload, if any —
  // used to default the object key so the file lands where they were looking.
  const folderPrefix = (dialogData?.data?.prefix as string | undefined) || ''

  // Form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [companionFiles, setCompanionFiles] = useState<File[]>([])
  const [customKey, setCustomKey] = useState('')
  const [convertToCloudNative, setConvertToCloudNative] = useState(true)
  const [targetFormat, setTargetFormat] = useState<string>('')
  const [recommendedFormat, setRecommendedFormat] = useState<string | null>(null)
  const [createSubfolder, setCreateSubfolder] = useState(true) // For GeoPackage layer extraction
  const [isGeoPackage, setIsGeoPackage] = useState(false)
  const [license, setLicense] = useState(LICENSE_CHOICES[0].id)
  const [licenseUrl, setLicenseUrl] = useState('')
  // Only an "other" license needs a link to its terms.
  const requestedLicenseUrl = license === 'other' ? licenseUrl.trim() || undefined : undefined

  // Upload state
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string; conversionJobId?: string } | null>(null)
  const [conversionJobId, setConversionJobId] = useState<string | null>(null)

  // GeoPackage -> PMTiles/COG layer picker (QGIS-style "select items to add")
  const [isInspecting, setIsInspecting] = useState(false)
  const [gpkgJobId, setGpkgJobId] = useState<string | null>(null)
  // Which pipeline the inspected GeoPackage is headed for — set once
  // inspection reveals whether it has vector layers or raster tables.
  const [gpkgFormat, setGpkgFormat] = useState<'pmtiles' | 'cog'>('pmtiles')
  const [gpkgLayers, setGpkgLayers] = useState<api.GeoPackageLayer[] | null>(null)
  const [gpkgRasterTables, setGpkgRasterTables] = useState<api.GeoPackageRasterTable[] | null>(null)
  const [selectedLayerNames, setSelectedLayerNames] = useState<Set<string>>(new Set())
  // Items shown in the picker table, whichever kind they are.
  const gpkgItems = gpkgLayers ?? gpkgRasterTables

  const isOpen = activeDialog === 's3upload'
  const isShapefile = !!selectedFile && /\.(shp|zip)$/i.test(selectedFile.name)
  const isTiff = !!selectedFile && /\.(tif|tiff)$/i.test(selectedFile.name)
  // A GeoPackage can hold vector layers (-> PMTiles) or raster tiles (-> COG);
  // CloudNativeGIS Lite figures out which, so offer both.
  const isGpkgFile = !!selectedFile && /\.gpkg$/i.test(selectedFile.name)
  const dropzoneBg = useColorModeValue('gray.50', 'gray.700')
  const dropzoneBorderColor = useColorModeValue('gray.300', 'gray.600')
  // Once the GeoPackage has been inspected, the layer picker (and later
  // the conversion progress) is the main event — collapse the file picker
  // down to a single-line summary for the rest of this dialog's lifetime.
  const gpkgFlowActive = !!gpkgItems
  const inLayerPickerMode = gpkgFlowActive && !conversionJobId

  // Fetch conversion tools status
  const { data: toolStatus, isLoading: isCheckingTools } = useQuery({
    queryKey: ['conversionTools'],
    queryFn: () => api.getConversionToolStatus(),
    enabled: isOpen,
  })
  const cngLiteConnected = !!toolStatus?.cloudnativegis?.available
  const showPMTiles = (isShapefile || isGpkgFile) && cngLiteConnected
  const showCOG = (isTiff || isGpkgFile) && cngLiteConnected

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

  const resetInputs = useCallback(() => {
    setSelectedFile(null)
    setCompanionFiles([])
    setCustomKey('')
    setConvertToCloudNative(true)
    setTargetFormat('')
    setRecommendedFormat(null)
    setCreateSubfolder(true)
    setIsGeoPackage(false)
    setLicense(LICENSE_CHOICES[0].id)
    setLicenseUrl('')
    setIsInspecting(false)
    setGpkgJobId(null)
    setGpkgFormat('pmtiles')
    setGpkgLayers(null)
    setGpkgRasterTables(null)
    setSelectedLayerNames(new Set())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  useEffect(() => {
    if (conversionJob?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId] })
      resetInputs()
    }
  }, [conversionJob?.status, connectionId, queryClient, resetInputs])

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      resetInputs()
      setUploadProgress(0)
      setUploadResult(null)
      setConversionJobId(null)
    }
  }, [isOpen, resetInputs])

  // Update recommended format when file changes
  useEffect(() => {
    if (selectedFile) {
      const recommended = showPMTiles
        ? 'pmtiles'
        : showCOG
          ? 'cog'
          : detectRecommendedConversion(selectedFile.name)
      setRecommendedFormat(recommended)
      setTargetFormat(recommended || '')
      // Detect if it's a GeoPackage
      const ext = selectedFile.name.split('.').pop()?.toLowerCase()
      setIsGeoPackage(ext === 'gpkg')
    }
  }, [selectedFile, showPMTiles, showCOG])

  const handleFileSelect = useCallback((files: File[]) => {
    if (isUploading || isConverting) return
    const file = files.find((component) => /\.shp$/i.test(component.name)) || files[0]
    if (!file) return
    if (files.length > 1 && !/\.shp$/i.test(file.name)) {
      toast({ title: 'Select one file, or the components of one shapefile', status: 'warning' })
      return
    }
    // Swapping files while a GeoPackage is pending layer selection would
    // otherwise leave its staged S3 upload behind — cancel it first.
    if (gpkgJobId) {
      api.cancelGeoPackageInspection(gpkgJobId).catch(() => {})
    }
    setSelectedFile(file)
    setCompanionFiles(files.filter((component) => component !== file))
    setUploadResult(null)
    setGpkgJobId(null)
    setGpkgFormat('pmtiles')
    setGpkgLayers(null)
    setGpkgRasterTables(null)
    setSelectedLayerNames(new Set())
    setCustomKey(folderPrefix + file.name)
  }, [isUploading, isConverting, toast, folderPrefix, gpkgJobId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileSelect(Array.from(e.dataTransfer.files))
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleUpload = async () => {
    if (isUploading || isConverting || isInspecting) return
    if (!selectedFile || !connectionId) {
      toast({
        title: 'Missing required fields',
        description: 'Please select a file',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    // A GeoPackage going through cng-lite is inspected first — it may
    // hold vector layers (-> PMTiles), raster tables (-> COG), or both;
    // only inspecting it tells us which, so the format picked so far is
    // just a guess. Stage it and ask what it actually contains.
    if (isGpkgFile && convertToCloudNative && cngLiteConnected) {
      setIsInspecting(true)
      setUploadResult(null)
      try {
        const { jobId, layers, rasterTables } = await api.inspectGeoPackage(
          connectionId, selectedFile, customKey || undefined, license, requestedLicenseUrl
        )
        if (layers.length === 0 && rasterTables.length === 0) {
          toast({
            title: 'Nothing to convert',
            description: 'This GeoPackage has no vector layers or raster tables.',
            status: 'warning',
            duration: 5000,
          })
          // Cancel the job the inspect step already created — it has
          // nothing to confirm, so it would otherwise sit there orphaned.
          await api.cancelGeoPackageInspection(jobId).catch(() => {})
          return
        }
        setGpkgJobId(jobId)
        if (layers.length > 0) {
          setGpkgFormat('pmtiles')
          setGpkgLayers(layers)
          setSelectedLayerNames(new Set(layers.map((layer) => layer.name)))
        } else {
          setGpkgFormat('cog')
          setGpkgRasterTables(rasterTables)
          setSelectedLayerNames(new Set(rasterTables.map((table) => table.name)))
        }
      } catch (err) {
        toast({
          title: 'Could not read GeoPackage',
          description: (err as Error).message,
          status: 'error',
          duration: 5000,
        })
      } finally {
        setIsInspecting(false)
      }
      return
    }

    setIsUploading(true)
    setUploadProgress(0)
    setUploadResult(null)
    setConversionJobId(null)

    try {
      const result = await api.uploadToS3(
        connectionId,
        selectedFile,
        customKey || undefined,
        convertToCloudNative && !!targetFormat,
        convertToCloudNative ? targetFormat || undefined : undefined,
        (progress) => setUploadProgress(progress),
        isGeoPackage ? createSubfolder : undefined,
        undefined,
        companionFiles,
        license,
        requestedLicenseUrl
      )

      setUploadResult({
        success: result.success,
        message: result.message,
        conversionJobId: result.conversionJobId,
      })

      if (result.conversionJobId) {
        setConversionJobId(result.conversionJobId)
      } else if (result.success) {
        resetInputs()
      }

      // Refresh object list
      queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId] })

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

  const toggleLayer = (name: string) => {
    setSelectedLayerNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleConfirmLayers = async () => {
    if (!gpkgJobId || selectedLayerNames.size === 0 || isUploading || isConverting) return

    setIsUploading(true)
    setUploadResult(null)

    try {
      const result = await api.convertGeoPackageLayers(gpkgJobId, Array.from(selectedLayerNames), gpkgFormat)

      setUploadResult({
        success: result.success,
        message: result.message,
        conversionJobId: result.conversionJobId,
      })

      if (result.conversionJobId) {
        setConversionJobId(result.conversionJobId)
      }

      queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId] })

      toast({
        title: 'Conversion started',
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
        title: 'Conversion failed',
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
        return showCOG
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

  const handleClose = () => {
    // Cancelling the layer picker means the raw GeoPackage staged in S3
    // during inspection would otherwise be left behind — clean it up.
    if (inLayerPickerMode && gpkgJobId) {
      api.cancelGeoPackageInspection(gpkgJobId).catch(() => {})
    }
    closeDialog()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="3xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="90vh">
        {/* Gradient Header */}
        <Box
          bg="surface.header"
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

          {isCheckingTools ? (
            <Center py={20}>
              <Spinner size="lg" color="orange.500" />
            </Center>
          ) : gpkgFlowActive ? (
            /* File picked and inspected — collapse to a one-line summary so
               the layer picker (and later the conversion progress) below
               is the main focus. */
            <HStack
              p={2}
              px={3}
              borderRadius="lg"
              border="1px solid"
              borderColor={dropzoneBorderColor}
              bg={dropzoneBg}
              cursor={inLayerPickerMode ? 'pointer' : 'default'}
              onClick={inLayerPickerMode ? () => fileInputRef.current?.click() : undefined}
            >
              <Icon as={FiFile} boxSize={4} color="orange.500" />
              <Text fontSize="sm" fontWeight="500" color="gray.700" noOfLines={1} flex="1">
                {selectedFile?.name}
              </Text>
              {selectedFile && (
                <Text fontSize="xs" color="gray.500" flexShrink={0}>
                  {formatFileSize(selectedFile.size)}
                </Text>
              )}
            </HStack>
          ) : (
            /* Cloud-Native Conversion Options are only shown when cng-lite
                is disconnected — when it's connected, conversion just
                happens automatically using the recommended format. */
            <HStack spacing={4} align="stretch">
              {/* Left column: File selection */}
              <VStack spacing={3} flex="1" align="stretch">
                {/* File Drop Zone */}
                <FormControl flex="1">
                  <FormLabel fontWeight="500" color="gray.700" fontSize="sm">File</FormLabel>
                  <Box
                    border="2px dashed"
                    borderColor={selectedFile ? 'orange.400' : dropzoneBorderColor}
                    borderRadius="lg"
                    p={8}
                    bg={selectedFile ? 'orange.50' : dropzoneBg}
                    textAlign="center"
                    cursor="pointer"
                    transition="all 0.2s"
                    _hover={{ borderColor: 'orange.400', bg: 'orange.50' }}
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    minH="260px"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    {selectedFile ? (
                      <VStack spacing={2}>
                        <Icon as={FiFile} boxSize={10} color="orange.500" />
                        <Text fontWeight="500" color="gray.700" fontSize="md" noOfLines={1}>{selectedFile.name}</Text>
                        <Text fontSize="sm" color="gray.500">
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
                      <VStack spacing={2}>
                        <Icon as={FiUpload} boxSize={10} color="gray.400" />
                        <Text color="gray.600" fontSize="md">
                          Drop file or click to browse
                        </Text>
                        <Text fontSize="sm" color="gray.500">
                          GeoTIFF, Shapefile, LAS, GeoPackage...
                        </Text>
                      </VStack>
                    )}
                  </Box>
                  {isShapefile && (
                    <Text fontSize="xs" color="gray.500" mt={1}>
                      Select .shp, .shx and .dbf together (plus .prj if available).
                      Cloudbench will ZIP them automatically.
                    </Text>
                  )}
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
                    {folderPrefix
                      ? `Defaults to the current folder: ${folderPrefix}`
                      : 'Leave empty to use original filename'}
                  </Text>
                </FormControl>

                {/* License (recorded in the generated Portolan catalog entry) */}
                <FormControl>
                  <FormLabel fontWeight="500" color="gray.700" fontSize="sm">License</FormLabel>
                  <Select
                    value={license}
                    isDisabled={isUploading || isConverting}
                    onChange={(e) => setLicense(e.target.value)}
                    size="sm"
                    borderRadius="lg"
                  >
                    {LICENSE_CHOICES.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>

                {license === 'other' && (
                  <FormControl>
                    <FormLabel fontWeight="500" color="gray.700" fontSize="sm">License URL (optional)</FormLabel>
                    <Input
                      type="url"
                      value={licenseUrl}
                      isDisabled={isUploading || isConverting}
                      onChange={(e) => setLicenseUrl(e.target.value)}
                      placeholder="https://example.org/data-license"
                      size="sm"
                      borderRadius="lg"
                    />
                    <Text fontSize="xs" color="gray.500" mt={1}>
                      Link to the license terms. Leave empty if they&apos;re not known — the catalog will say so.
                    </Text>
                  </FormControl>
                )}
              </VStack>

              {!cngLiteConnected && (
                <VStack spacing={3} flex="1" align="stretch">
                  {recommendedFormat || showPMTiles ? (
                    <Box p={2} bg="orange.50" borderRadius="lg" border="1px solid" borderColor="orange.200">
                      <HStack justify="space-between" mb={1}>
                        <Text fontWeight="500" color="gray.700" fontSize="xs">Convert to Cloud-Native</Text>
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
                    <Box p={2} bg="gray.50" borderRadius="lg" border="1px solid" borderColor="gray.200">
                      <Text fontSize="xs" color="gray.500" textAlign="center">
                        Select a file to see conversion options
                      </Text>
                    </Box>
                  )}
                </VStack>
              )}
            </HStack>
          )}

          {/* GeoPackage layer/table picker (QGIS-style "Select Items to Add") —
              the main focus of the dialog once a GeoPackage is inspected.
              Vector layers (-> PMTiles) show geometry/feature columns;
              raster tables (-> COG) are name-only. */}
          {inLayerPickerMode && gpkgItems && (
            <Box mt={3} p={4} bg="blue.50" borderRadius="lg" border="1px solid" borderColor="blue.200">
              <HStack justify="space-between" mb={3}>
                <Text fontWeight="600" color="gray.700" fontSize="md">
                  Select {gpkgFormat === 'cog' ? 'raster tables' : 'layers'} to convert ({selectedLayerNames.size}/{gpkgItems.length})
                </Text>
                <HStack spacing={1}>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedLayerNames(new Set(gpkgItems.map((item) => item.name)))}
                  >
                    Select All
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setSelectedLayerNames(new Set())}>
                    Deselect All
                  </Button>
                </HStack>
              </HStack>
              <Box maxH="380px" overflowY="auto" borderRadius="md" border="1px solid" borderColor="gray.200" bg="white">
                <Table size="sm">
                  <Thead position="sticky" top={0} bg="gray.50">
                    <Tr>
                      <Th width="1%" />
                      <Th>{gpkgFormat === 'cog' ? 'Table' : 'Layer'}</Th>
                      {gpkgFormat === 'pmtiles' && <Th>Geometry</Th>}
                      {gpkgFormat === 'pmtiles' && <Th isNumeric>Features</Th>}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {gpkgItems.map((item) => {
                      const layer = gpkgFormat === 'pmtiles' ? (item as api.GeoPackageLayer) : null
                      return (
                        <Tr key={item.name} cursor="pointer" onClick={() => toggleLayer(item.name)}>
                          <Td onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              isChecked={selectedLayerNames.has(item.name)}
                              onChange={() => toggleLayer(item.name)}
                            />
                          </Td>
                          <Td fontSize="sm" fontWeight="500">{item.name}</Td>
                          {layer && (
                            <>
                              <Td fontSize="sm" color="gray.500">{layer.geometryType}</Td>
                              <Td fontSize="sm" color="gray.500" isNumeric>{layer.featureCount.toLocaleString()}</Td>
                            </>
                          )}
                        </Tr>
                      )
                    })}
                  </Tbody>
                </Table>
              </Box>
            </Box>
          )}

          {/* Conversion progress — takes over the layer picker's spot as
              the main focus once the layers have been confirmed. */}
          {gpkgFlowActive && !inLayerPickerMode && conversionJob && ['pending', 'running'].includes(conversionJob.status) && (
            <Box mt={3} p={4} bg="blue.50" borderRadius="lg" border="1px solid" borderColor="blue.200">
              <HStack mb={2}>
                <Icon as={FiRefreshCw} className="spin" color="blue.500" />
                <Text fontWeight="600" color="gray.700" fontSize="md">Converting layers...</Text>
              </HStack>
              <Progress
                value={conversionJob.progress}
                size="sm"
                colorScheme="blue"
                borderRadius="sm"
                hasStripe
                isAnimated
              />
              <Text fontSize="sm" color="gray.600" mt={2}>
                {conversionJob.message}
              </Text>
              {(() => {
                const layerStatuses = layerConversionStatuses(conversionJob)
                if (!layerStatuses) return null
                return (
                  <VStack align="stretch" spacing={1} mt={3} pt={3} borderTop="1px solid" borderColor="blue.100" maxH="300px" overflowY="auto">
                    {layerStatuses.map((layer) => (
                      <HStack key={layer.name} spacing={2}>
                        {layer.status === 'done' && <Icon as={FiCheckCircle} color="green.500" boxSize={4} />}
                        {layer.status === 'active' && (
                          <Icon as={FiRefreshCw} className="spin" color="blue.500" boxSize={4} />
                        )}
                        {layer.status === 'pending' && <Icon as={FiCircle} color="gray.300" boxSize={4} />}
                        <Text
                          fontSize="sm"
                          color={layer.status === 'pending' ? 'gray.400' : 'gray.700'}
                          fontWeight={layer.status === 'active' ? '600' : '400'}
                        >
                          {layer.name}
                        </Text>
                      </HStack>
                    ))}
                  </VStack>
                )
              })()}
            </Box>
          )}

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
                  borderRadius="sm"
                  hasStripe
                  isAnimated
                />
              </Box>
            )}

            {/* Conversion Job Progress (GeoPackage jobs show this above instead) */}
            {!gpkgFlowActive && conversionJob && ['pending', 'running'].includes(conversionJob.status) && (
              <Box w="100%" p={2} bg="blue.50" borderRadius="lg">
                <HStack mb={1}>
                  <Icon as={FiRefreshCw} className="spin" color="blue.500" boxSize={3} />
                  <Text fontWeight="500" color="blue.700" fontSize="xs">Converting...</Text>
                </HStack>
                <Progress
                  value={conversionJob.progress}
                  size="xs"
                  colorScheme="blue"
                  borderRadius="sm"
                  hasStripe
                  isAnimated
                />
                <Text fontSize="xs" color="gray.600" mt={1}>
                  {conversionJob.message}
                </Text>
                {(() => {
                  const layerStatuses = layerConversionStatuses(conversionJob)
                  if (!layerStatuses) return null
                  return (
                    <VStack align="stretch" spacing={0.5} mt={2} pt={2} borderTop="1px solid" borderColor="blue.100">
                      {layerStatuses.map((layer) => (
                        <HStack key={layer.name} spacing={2}>
                          {layer.status === 'done' && <Icon as={FiCheckCircle} color="green.500" boxSize={3} />}
                          {layer.status === 'active' && (
                            <Icon as={FiRefreshCw} className="spin" color="blue.500" boxSize={3} />
                          )}
                          {layer.status === 'pending' && <Icon as={FiCircle} color="gray.300" boxSize={3} />}
                          <Text
                            fontSize="xs"
                            color={layer.status === 'pending' ? 'gray.400' : 'gray.700'}
                            fontWeight={layer.status === 'active' ? '600' : '400'}
                          >
                            {layer.name}
                          </Text>
                        </HStack>
                      ))}
                    </VStack>
                  )
                })()}
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
                      {conversionJob.outputPath ? (
                        <Text fontSize="xs" color="gray.600">
                          Output: {conversionJob.outputPath}
                        </Text>
                      ) : (
                        <>
                          <Text fontSize="xs" color="gray.600">
                            {conversionJob.outputPaths?.length ?? 0} files created:
                          </Text>
                          {conversionJob.outputPaths?.map((path) => (
                            <Text key={path} fontSize="xs" color="gray.600" noOfLines={1}>
                              {path}
                            </Text>
                          ))}
                        </>
                      )}
                    </Box>
                  </Alert>
                  {conversionJob.error && (
                    <Alert status="warning" borderRadius="lg" variant="subtle" py={2} mt={2}>
                      <AlertIcon boxSize={4} />
                      <Box>
                        <Text fontSize="xs" fontWeight="500">Some layers were skipped</Text>
                        {conversionJob.error.split('; ').map((line) => (
                          <Text key={line} fontSize="xs" color="gray.600">
                            {line}
                          </Text>
                        ))}
                      </Box>
                    </Alert>
                  )}
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
          <Button variant="ghost" onClick={handleClose} borderRadius="lg">
            {uploadResult?.success ? 'Close' : 'Cancel'}
          </Button>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            {inLayerPickerMode ? (
              <Button
                colorScheme="orange"
                onClick={handleConfirmLayers}
                isLoading={isUploading || isConverting}
                loadingText="Converting..."
                isDisabled={selectedLayerNames.size === 0}
                borderRadius="lg"
                px={6}
                leftIcon={<FiUpload />}
              >
                Convert {selectedLayerNames.size} {gpkgFormat === 'cog' ? 'Table' : 'Layer'}{selectedLayerNames.size === 1 ? '' : 's'}
              </Button>
            ) : (
              <Button
                colorScheme="orange"
                onClick={handleUpload}
                isLoading={isUploading || isConverting || isInspecting}
                loadingText={isConverting ? 'Converting...' : isInspecting ? 'Reading GeoPackage...' : 'Uploading...'}
                isDisabled={
                  !selectedFile ||
                  (convertToCloudNative && !!targetFormat && !canConvert(targetFormat))
                }
                borderRadius="lg"
                px={6}
                leftIcon={<FiUpload />}
              >
                Upload
              </Button>
            )}
          </motion.div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

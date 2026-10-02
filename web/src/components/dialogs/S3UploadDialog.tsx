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
  Code,
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
import { FiUpload, FiFile, FiCheckCircle, FiAlertCircle, FiRefreshCw, FiCircle, FiLayers } from 'react-icons/fi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import type { ConversionJob } from '../../types'
import { isActiveStatus, layerConversionStatuses } from '../../utils/conversionJobs'
import { checkShapefileParts, SHAPEFILE_PART } from '../../utils/shapefile'
import { CONVERSION_JOBS_QUERY_KEY } from '../JobsIndicator'

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

// A row in the GeoPackage picker: a vector layer (-> PMTiles) or raster table (-> COG).
interface GpkgItem {
  key: string
  name: string
  kind: 'vector' | 'raster'
  geometryType?: string
  featureCount?: number
}

// Helper to detect recommended conversion
const TIFF_PATTERN = /\.(tif|tiff)$/i
// Single-file vector sources CloudNativeGIS converts as one layer each.
const VECTOR_FILE_PATTERN = /\.(geojson|fgb|kml|kmz)$/i

// A mosaic's default name: what its tiles' names have in common
// ("dem_n01.tif", "dem_n02.tif" -> "dem"), else the first tile's.
export function defaultMosaicName(files: File[]): string {
  const stems = files.map((file) => file.name.replace(TIFF_PATTERN, ''))
  let common = stems[0] ?? ''
  for (const stem of stems.slice(1)) {
    while (!stem.startsWith(common)) common = common.slice(0, -1)
  }
  // Drop digits the tile numbers only share in part ("dem_0" from "dem_01",
  // "dem_02"), but not whole numbers in the name ("Ortho 2024 - 1").
  const numberContinues = stems.every((stem) => /\d/.test(stem.charAt(common.length)))
  if (numberContinues) common = common.replace(/\d+$/, '')
  common = common.replace(/[\s_.-]+$/, '')
  return common || `${stems[0] ?? 'tiles'} mosaic`
}

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
  const [license, setLicense] = useState(LICENSE_CHOICES[0].id)
  const [licenseUrl, setLicenseUrl] = useState('')
  const [mosaicName, setMosaicName] = useState('')
  // Only an "other" license needs a link to its terms.
  const requestedLicenseUrl = license === 'other' ? licenseUrl.trim() || undefined : undefined

  // Upload state
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string; conversionJobId?: string } | null>(null)
  const [conversionJobId, setConversionJobId] = useState<string | null>(null)

  // GeoPackage -> PMTiles/COG layer picker (QGIS-style "select items to add")
  const [isInspecting, setIsInspecting] = useState(false)
  // The converted upload's folder already exists: waiting for the user to
  // confirm replacing it (see handleUpload).
  const [pendingReplace, setPendingReplace] = useState<api.PortolanTarget | null>(null)
  const [gpkgJobId, setGpkgJobId] = useState<string | null>(null)
  // Which pipeline the inspected GeoPackage is headed for — set once
  // inspection reveals whether it has vector layers or raster tables.
  const [gpkgLayers, setGpkgLayers] = useState<api.GeoPackageLayer[] | null>(null)
  const [gpkgRasterTables, setGpkgRasterTables] = useState<api.GeoPackageRasterTable[] | null>(null)
  const [selectedLayerNames, setSelectedLayerNames] = useState<Set<string>>(new Set())
  // Every job a GeoPackage confirm started, in the order they run (vector
  // layers, then raster tables); conversionJobId is the one being followed.
  const [conversionJobIds, setConversionJobIds] = useState<string[]>([])
  // The earlier of those jobs, once finished (shown above the last one's result).
  const [earlierJobs, setEarlierJobs] = useState<ConversionJob[]>([])
  // Items shown in the picker table: vector layers and raster tables, keyed
  // by kind so a layer and a table sharing a name stay distinct.
  const gpkgItems: GpkgItem[] | null =
    gpkgLayers || gpkgRasterTables
      ? [
          ...(gpkgLayers ?? []).map((layer) => ({
            key: `vector:${layer.name}`,
            name: layer.name,
            kind: 'vector' as const,
            geometryType: layer.geometryType,
            featureCount: layer.featureCount,
          })),
          ...(gpkgRasterTables ?? []).map((table) => ({
            key: `raster:${table.name}`,
            name: table.name,
            kind: 'raster' as const,
          })),
        ]
      : null
  const selectedItems = gpkgItems?.filter((item) => selectedLayerNames.has(item.key)) ?? []
  const selectedVector = selectedItems.filter((item) => item.kind === 'vector')
  const selectedRaster = selectedItems.filter((item) => item.kind === 'raster')
  const hasVectorItems = !!gpkgItems?.some((item) => item.kind === 'vector')
  const hasRasterItems = !!gpkgItems?.some((item) => item.kind === 'raster')
  const itemNoun = (count: number, kinds: GpkgItem[]) => {
    const vector = kinds.some((item) => item.kind === 'vector')
    const raster = kinds.some((item) => item.kind === 'raster')
    const noun = vector && raster ? 'item' : raster ? 'raster table' : 'layer'
    return count === 1 ? noun : `${noun}s`
  }

  const isOpen = activeDialog === 's3upload'
  const isShapefile = !!selectedFile && /\.(shp|zip)$/i.test(selectedFile.name)
  // Loose shapefile components: checked before uploading, as the server
  // would only check them once every byte had arrived.
  // Only for a shapefile being converted, or several of its parts: one
  // .dbf (or .shp) uploaded as it is, unconverted, is just a file.
  const convertingNow = convertToCloudNative && !!targetFormat
  const shapefileCheck =
    selectedFile &&
    SHAPEFILE_PART.test(selectedFile.name) &&
    (companionFiles.length > 0 || (/\.shp$/i.test(selectedFile.name) && convertingNow))
      ? checkShapefileParts([selectedFile, ...companionFiles], convertingNow)
      : null
  const shapefileBlocked = !!shapefileCheck?.problems.length
  const isTiff = !!selectedFile && TIFF_PATTERN.test(selectedFile.name)
  // Several GeoTIFFs at once: published together as one mosaic.
  const mosaicFiles =
    selectedFile && isTiff && companionFiles.length > 0 && companionFiles.every((file) => TIFF_PATTERN.test(file.name))
      ? [selectedFile, ...companionFiles]
      : null
  const isMosaic = !!mosaicFiles
  // A GeoPackage can hold vector layers (-> PMTiles) or raster tiles (-> COG);
  // CloudNativeGIS Lite figures out which, so offer both.
  const isGpkgFile = !!selectedFile && /\.gpkg$/i.test(selectedFile.name)
  const isVectorFile = !!selectedFile && VECTOR_FILE_PATTERN.test(selectedFile.name)
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
  const showPMTiles = (isShapefile || isGpkgFile || isVectorFile) && cngLiteConnected
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
    (!conversionJob || isActiveStatus(conversionJob.status))

  const resetInputs = useCallback(() => {
    setSelectedFile(null)
    setCompanionFiles([])
    setCustomKey('')
    setConvertToCloudNative(true)
    setTargetFormat('')
    setRecommendedFormat(null)
    setLicense(LICENSE_CHOICES[0].id)
    setLicenseUrl('')
    setMosaicName('')
    setIsInspecting(false)
    setGpkgJobId(null)
    setConversionJobIds([])
    setGpkgLayers(null)
    setGpkgRasterTables(null)
    setSelectedLayerNames(new Set())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // The job whose finish was last handled. Resetting the form changes this
  // effect's dependencies (conversionJobIds becomes a new []), so without it
  // the same finished job was handled again on every render, forever.
  const handledJobRef = useRef<string | null>(null)

  // When the followed job finishes: move on to the next one if a GeoPackage
  // confirm started several (its raster tables after its vector layers),
  // keeping this one's outcome; once the last one completes, reset the form.
  useEffect(() => {
    if (!conversionJob || !conversionJobId) return
    if (!['completed', 'failed', 'cancelled'].includes(conversionJob.status)) return
    if (handledJobRef.current === conversionJobId) return
    handledJobRef.current = conversionJobId
    if (conversionJob.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId] })
    }
    const next = conversionJobIds[conversionJobIds.indexOf(conversionJobId) + 1]
    if (next) {
      setEarlierJobs((jobs) => [...jobs, conversionJob])
      setConversionJobId(next)
      return
    }
    if (conversionJob.status === 'completed') resetInputs()
  }, [conversionJob, conversionJobId, conversionJobIds, connectionId, queryClient, resetInputs])

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      resetInputs()
      setUploadProgress(0)
      setUploadResult(null)
      setConversionJobId(null)
      setEarlierJobs([])
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
    }
  }, [selectedFile, showPMTiles, showCOG])

  const handleFileSelect = useCallback((picked: File[]) => {
    if (isUploading || isConverting) return
    // More parts of the shapefile already selected (e.g. its forgotten
    // .prj) join the selection rather than replace it.
    const stemOf = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase()
    const current = selectedFile ? [selectedFile, ...companionFiles] : []
    const addsParts =
      current.length > 0 &&
      SHAPEFILE_PART.test(current[0].name) &&
      picked.every((f) => SHAPEFILE_PART.test(f.name) && stemOf(f.name) === stemOf(current[0].name))
    const files = addsParts
      ? [...current.filter((f) => !picked.some((p) => p.name === f.name)), ...picked]
      : picked
    const file = files.find((component) => /\.shp$/i.test(component.name)) || files[0]
    if (!file) return
    const allTiffs = files.length > 1 && files.every((component) => TIFF_PATTERN.test(component.name))
    const allShapefileParts = files.every((component) => SHAPEFILE_PART.test(component.name))
    if (files.length > 1 && !/\.shp$/i.test(file.name) && !allTiffs && !allShapefileParts) {
      toast({
        title: 'Select one file, the components of one shapefile, or several GeoTIFFs to combine into a mosaic',
        status: 'warning',
      })
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
    setConversionJobIds([])
    setGpkgLayers(null)
    setGpkgRasterTables(null)
    setSelectedLayerNames(new Set())
    setCustomKey(folderPrefix + file.name)
    setMosaicName(allTiffs ? defaultMosaicName(files) : '')
  }, [isUploading, isConverting, toast, folderPrefix, gpkgJobId, selectedFile, companionFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileSelect(Array.from(e.dataTransfer.files))
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // A different file or target key means a different folder to check.
  useEffect(() => {
    setPendingReplace(null)
  }, [selectedFile, customKey])

  const handleUpload = async (replace = false) => {
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
    setPendingReplace(null)
    if (shapefileCheck?.problems.length) {
      toast({
        title: 'This shapefile is incomplete',
        description: shapefileCheck.problems.join(' '),
        status: 'warning',
        duration: 6000,
      })
      return
    }

    // A conversion publishes into a layer folder (or, for a GeoPackage, a
    // layer-group folder) named after the file: ask before replacing one
    // that already exists, rather than sending the file to have it refused.
    if (isMosaic && !cngLiteConnected) {
      toast({
        title: 'CloudNativeGIS is not available',
        description: 'Combining GeoTIFFs into a mosaic needs the CloudNativeGIS conversion service.',
        status: 'error',
        duration: 5000,
      })
      return
    }
    if (isMosaic && !mosaicName.trim()) {
      toast({ title: 'Name the mosaic', status: 'warning', duration: 3000 })
      return
    }

    if (!replace && (isMosaic || convertToCloudNative) && cngLiteConnected) {
      try {
        // A mosaic publishes into a folder named after it, as a file does after itself.
        const target = isMosaic
          ? await api.checkPortolanTarget(connectionId, `${mosaicName.trim()}.tif`, `${folderPrefix}${mosaicName.trim()}.tif`)
          : await api.checkPortolanTarget(connectionId, selectedFile.name, customKey || undefined)
        if (target.exists) {
          setPendingReplace(target)
          return
        }
      } catch {
        // The upload itself still refuses to overwrite (409) without replace.
      }
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
          connectionId, selectedFile, customKey || undefined, license, requestedLicenseUrl, replace
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
        // Offer both kinds; everything starts selected.
        setGpkgLayers(layers)
        setGpkgRasterTables(rasterTables)
        setSelectedLayerNames(
          new Set([
            ...layers.map((layer) => `vector:${layer.name}`),
            ...rasterTables.map((table) => `raster:${table.name}`),
          ])
        )
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
      const result = mosaicFiles
        ? await api.uploadMosaic(
            connectionId,
            mosaicFiles,
            mosaicName.trim(),
            folderPrefix.replace(/\/+$/, ''),
            (progress) => setUploadProgress(progress),
            license,
            requestedLicenseUrl,
            replace
          )
        : await api.uploadToS3(
            connectionId,
            selectedFile,
            customKey || undefined,
            convertToCloudNative && !!targetFormat,
            convertToCloudNative ? targetFormat || undefined : undefined,
            (progress) => setUploadProgress(progress),
            // A converted GeoPackage always gets its own folder (a Portolan
            // sub-catalog of its layers, see apps.s3.cng_lite.run_conversion).
            undefined,
            undefined,
            companionFiles,
            license,
            requestedLicenseUrl,
            replace
          )

      setUploadResult({
        success: result.success,
        message: result.message,
        conversionJobId: result.conversionJobId,
      })

      if (result.conversionJobId) {
        setConversionJobId(result.conversionJobId)
        queryClient.invalidateQueries({ queryKey: CONVERSION_JOBS_QUERY_KEY })
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

  const toggleLayer = (key: string) => {
    setSelectedLayerNames((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleConfirmLayers = async () => {
    if (!gpkgJobId || selectedItems.length === 0 || isUploading || isConverting) return

    setIsUploading(true)
    setUploadResult(null)

    try {
      setEarlierJobs([])
      const result = await api.convertGeoPackage(
        gpkgJobId,
        selectedVector.map((item) => item.name),
        selectedRaster.map((item) => item.name)
      )
      setConversionJobIds(result.conversionJobIds ?? (result.conversionJobId ? [result.conversionJobId] : []))

      setUploadResult({
        success: result.success,
        message: result.message,
        conversionJobId: result.conversionJobId,
      })

      if (result.conversionJobId) {
        setConversionJobId(result.conversionJobId)
      }

      queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId] })
      queryClient.invalidateQueries({ queryKey: CONVERSION_JOBS_QUERY_KEY })

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
                    {mosaicFiles ? (
                      <VStack spacing={2}>
                        <Icon as={FiLayers} boxSize={10} color="orange.500" />
                        <Text fontWeight="500" color="gray.700" fontSize="md">
                          {mosaicFiles.length} GeoTIFFs
                        </Text>
                        <Text fontSize="sm" color="gray.500">
                          {formatFileSize(mosaicFiles.reduce((total, file) => total + file.size, 0))}
                        </Text>
                        <Text fontSize="xs" color="gray.600" noOfLines={3}>
                          {mosaicFiles.map((file) => file.name).join(', ')}
                        </Text>
                        <Badge colorScheme="orange" fontSize="xs">→ ONE MOSAIC</Badge>
                      </VStack>
                    ) : selectedFile ? (
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
                          GeoTIFF, Shapefile, GeoPackage, GeoJSON, FlatGeobuf, KML/KMZ, LAS...
                          or several GeoTIFFs for one mosaic
                        </Text>
                      </VStack>
                    )}
                  </Box>
                  {shapefileCheck ? (
                    <Box mt={2} fontSize="xs">
                      <HStack spacing={3} wrap="wrap">
                        {['.shp', '.shx', '.dbf', '.prj'].map((part) => {
                          const present = !shapefileCheck.missing.includes(part) &&
                            [selectedFile, ...companionFiles].some((f) => f?.name.toLowerCase().endsWith(part))
                          const needed = shapefileCheck.missing.includes(part)
                          return (
                            <HStack key={part} spacing={1}>
                              <Icon
                                as={present ? FiCheckCircle : needed ? FiAlertCircle : FiCircle}
                                color={present ? 'green.500' : needed ? 'red.500' : 'gray.400'}
                              />
                              <Text color={needed ? 'red.600' : 'gray.600'}>{part}</Text>
                            </HStack>
                          )
                        })}
                      </HStack>
                      {shapefileCheck.problems.map((problem) => (
                        <Text key={problem} color="red.600" mt={1}>{problem}</Text>
                      ))}
                      {shapefileCheck.warnings.map((warning) => (
                        <Text key={warning} color="orange.600" mt={1}>{warning}</Text>
                      ))}
                      <Text color="gray.500" mt={1}>
                        {shapefileBlocked
                          ? 'Pick the missing parts to add them to this selection.'
                          : 'Cloudbench will ZIP them automatically.'}
                      </Text>
                    </Box>
                  ) : isShapefile ? (
                    <Text fontSize="xs" color="gray.500" mt={1}>
                      Select .shp, .shx and .dbf together (plus .prj if available).
                      Cloudbench will ZIP them automatically.
                    </Text>
                  ) : selectedFile && /\.(kml|kmz)$/i.test(selectedFile.name) && showPMTiles && (
                    <Text fontSize="xs" color="gray.500" mt={1}>
                      A KML's folders become one layer, each feature's folder kept in a "folder" column.
                    </Text>
                  )}
                </FormControl>

                {isMosaic ? (
                  <FormControl>
                    <FormLabel fontWeight="500" color="gray.700" fontSize="sm">Mosaic name</FormLabel>
                    <Input
                      value={mosaicName}
                      isDisabled={isUploading || isConverting}
                      onChange={(e) => setMosaicName(e.target.value)}
                      placeholder="Elevation 2024"
                      size="sm"
                      borderRadius="lg"
                    />
                    <Text fontSize="xs" color="gray.500" mt={1}>
                      The tiles are published together as one raster collection
                      {folderPrefix ? ` in ${folderPrefix}` : ''}: every tile, a VRT of them all,
                      and a merged web map. They must share one CRS, bands, data type and nodata.
                    </Text>
                  </FormControl>
                ) : (
                /* Object Key (path) */
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
                )}

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
                  Select {itemNoun(2, gpkgItems)} to convert ({selectedItems.length}/{gpkgItems.length})
                </Text>
                <HStack spacing={1}>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedLayerNames(new Set(gpkgItems.map((item) => item.key)))}
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
                      <Th>{hasVectorItems ? 'Layer' : 'Table'}</Th>
                      {hasVectorItems && hasRasterItems && <Th>Type</Th>}
                      {hasVectorItems && <Th>Geometry</Th>}
                      {hasVectorItems && <Th isNumeric>Features</Th>}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {gpkgItems.map((item) => (
                      <Tr key={item.key} cursor="pointer" onClick={() => toggleLayer(item.key)}>
                        <Td onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            isChecked={selectedLayerNames.has(item.key)}
                            onChange={() => toggleLayer(item.key)}
                          />
                        </Td>
                        <Td fontSize="sm" fontWeight="500">{item.name}</Td>
                        {hasVectorItems && hasRasterItems && (
                          <Td>
                            <Badge colorScheme={item.kind === 'vector' ? 'blue' : 'orange'} variant="subtle" fontSize="xs">
                              {item.kind === 'vector' ? 'Vector' : 'Raster'}
                            </Badge>
                          </Td>
                        )}
                        {hasVectorItems && (
                          <>
                            <Td fontSize="sm" color="gray.500">{item.geometryType ?? '-'}</Td>
                            <Td fontSize="sm" color="gray.500" isNumeric>
                              {item.featureCount !== undefined ? item.featureCount.toLocaleString() : '-'}
                            </Td>
                          </>
                        )}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Box>
          )}

          {/* Conversion progress — takes over the layer picker's spot as
              the main focus once the layers have been confirmed. */}
          {gpkgFlowActive && !inLayerPickerMode && conversionJob && isActiveStatus(conversionJob.status) && (
            <Box mt={3} p={4} bg="blue.50" borderRadius="lg" border="1px solid" borderColor="blue.200">
              <HStack mb={2}>
                <Icon as={FiRefreshCw} className="spin" color="blue.500" />
                <Text fontWeight="600" color="gray.700" fontSize="md">
                  {conversionJob.targetFormat === 'cog' ? 'Converting raster tables...' : 'Converting layers...'}
                  {conversionJobIds.length > 1 &&
                    ` (${conversionJobIds.indexOf(conversionJobId ?? '') + 1} of ${conversionJobIds.length})`}
                </Text>
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
              <Text fontSize="xs" color="gray.500" mt={1}>
                You can close this dialog: the conversion carries on, and its progress stays under Jobs in the header.
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
            {!gpkgFlowActive && conversionJob && isActiveStatus(conversionJob.status) && (
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
                <Text fontSize="xs" color="gray.500">
                  You can close this dialog: progress stays under Jobs in the header.
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

              {/* A GeoPackage converted both ways: how its first job (the
                  vector layers) went, above the last one's result. */}
              {earlierJobs.map((job) => (
                <Alert
                  key={job.id}
                  status={job.status === 'completed' ? (job.error ? 'warning' : 'success') : 'error'}
                  borderRadius="lg"
                  variant="subtle"
                  py={2}
                >
                  <AlertIcon boxSize={4} />
                  <Box>
                    <Text fontSize="xs" fontWeight="500">
                      {job.targetFormat === 'cog' ? 'Raster tables' : 'Vector layers'}: {job.message}
                    </Text>
                    {job.error && (
                      <Text fontSize="xs" color="gray.600">
                        {job.error}
                      </Text>
                    )}
                  </Box>
                </Alert>
              ))}

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

        {pendingReplace && (
          <Alert status="warning" borderRadius={0} alignItems="flex-start" py={3}>
            <AlertIcon />
            <VStack align="stretch" spacing={2} flex="1">
              <Text fontSize="sm">
                A {pendingReplace.kind} already exists at <Code fontSize="xs">{pendingReplace.folder}/</Code>.
                Replacing removes everything currently in that folder
                {pendingReplace.kind === 'layer group' ? ', including layers you don\'t select this time,' : ''}
                {' '}and publishes this upload there.
              </Text>
              <HStack justify="flex-end" spacing={2}>
                <Button size="sm" variant="ghost" onClick={() => setPendingReplace(null)}>
                  Keep existing
                </Button>
                <Button size="sm" colorScheme="red" onClick={() => handleUpload(true)}>
                  Replace
                </Button>
              </HStack>
            </VStack>
          </Alert>
        )}

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
                isDisabled={selectedItems.length === 0}
                borderRadius="lg"
                px={6}
                leftIcon={<FiUpload />}
              >
                Convert {selectedItems.length} {itemNoun(selectedItems.length, selectedItems)}
              </Button>
            ) : (
              <Button
                colorScheme="orange"
                onClick={() => handleUpload()}
                isLoading={isUploading || isConverting || isInspecting}
                loadingText={isConverting ? 'Converting...' : isInspecting ? 'Reading GeoPackage...' : 'Uploading...'}
                isDisabled={
                  !selectedFile ||
                  shapefileBlocked ||
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

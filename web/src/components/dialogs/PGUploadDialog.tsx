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
  List,
  ListItem,
  ListIcon,
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
} from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api/client'

interface FileUpload {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'uploaded' | 'importing' | 'success' | 'error'
  error?: string
  filePath?: string
  layers?: api.LayerInfo[]
  isRaster?: boolean
  jobId?: string
}

interface SelectedLayer {
  name: string
  selected: boolean
  tableName: string
}

export default function PGUploadDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [files, setFiles] = useState<FileUpload[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)
  const [selectedLayers, setSelectedLayers] = useState<SelectedLayer[]>([])
  const [loadingLayers, setLoadingLayers] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [targetSchema, setTargetSchema] = useState('public')
  const [overwrite, setOverwrite] = useState(false)
  const [targetSRID, setTargetSRID] = useState<number | undefined>(undefined)
  const [ogrStatus, setOgrStatus] = useState<api.OGR2OGRStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const dropzoneBg = useColorModeValue('gray.50', 'gray.700')
  const dropzoneBorder = useColorModeValue('gray.300', 'gray.600')

  const isOpen = activeDialog === 'pgupload'
  const serviceName = dialogData?.data?.serviceName as string | undefined
  const initialSchema = dialogData?.data?.schemaName as string | undefined

  // Fetch ogr2ogr status when dialog opens
  useEffect(() => {
    if (isOpen) {
      api.getOGR2OGRStatus().then(setOgrStatus).catch(console.error)
      setFiles([])
      setUploadComplete(false)
      setSelectedLayers([])
      setShowAdvanced(false)
      setTargetSchema(initialSchema || 'public')
      setOverwrite(false)
      setTargetSRID(undefined)
    }
  }, [isOpen, initialSchema])

  const isRasterFile = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop() || ''
    return ['.tif', '.tiff', '.img', '.jp2', '.ecw', '.sid', '.asc', '.dem', '.hgt', '.nc', '.vrt']
      .some(rasterExt => rasterExt.slice(1) === ext)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFiles = Array.from(e.dataTransfer.files)
    addFiles(droppedFiles)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files)
      addFiles(selectedFiles)
    }
  }

  const addFiles = (newFiles: File[]) => {
    if (!ogrStatus) {
      toast({
        title: 'Import tools not available',
        description: 'Please ensure ogr2ogr and raster2pgsql are installed',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    const supportedExts = Object.keys(ogrStatus.supported_extensions)
    const validFiles = newFiles.filter((file) => {
      const ext = '.' + file.name.toLowerCase().split('.').pop()
      return supportedExts.includes(ext)
    })

    if (validFiles.length < newFiles.length) {
      toast({
        title: 'Some files skipped',
        description: 'Only supported geospatial formats are accepted',
        status: 'warning',
        duration: 3000,
      })
    }

    setFiles((prev) => [
      ...prev,
      ...validFiles.map((file) => ({
        file,
        progress: 0,
        status: 'pending' as const,
        isRaster: isRasterFile(file.name),
      })),
    ])
    setUploadComplete(false)
    setSelectedLayers([])
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (!serviceName) {
      toast({
        title: 'No service selected',
        description: 'Please select a PostgreSQL service first',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    if (files.length === 0) {
      toast({
        title: 'No files selected',
        description: 'Please select files to upload',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsUploading(true)

    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== 'pending') continue

      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: 'uploading' as const } : f
        )
      )

      try {
        const result = await api.uploadFileForImport(files[i].file, (progress) => {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, progress } : f
            )
          )
        })

        // Detect layers in the uploaded file
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'uploaded' as const, progress: 100, filePath: result.file_path } : f
          )
        )

        // For vector files, detect available layers
        if (!files[i].isRaster) {
          setLoadingLayers(true)
          try {
            const layers = await api.detectLayers(result.file_path)
            setFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, layers } : f
              )
            )

            // Add to selected layers
            if (layers.length > 0) {
              const newSelectedLayers = layers.map((l) => ({
                name: l.name,
                selected: true,
                tableName: l.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
              }))
              setSelectedLayers((prev) => [...prev, ...newSelectedLayers])
            } else {
              // Fallback: use filename as layer name when no layers detected
              const baseName = files[i].file.name.replace(/\.[^/.]+$/, '')
              const tableName = baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
              setSelectedLayers((prev) => [...prev, {
                name: baseName,
                selected: true,
                tableName,
              }])
            }
          } catch (err) {
            console.error('Failed to detect layers:', err)
            // Fallback: use filename as layer name on error
            const baseName = files[i].file.name.replace(/\.[^/.]+$/, '')
            const tableName = baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
            setSelectedLayers((prev) => [...prev, {
              name: baseName,
              selected: true,
              tableName,
            }])
          } finally {
            setLoadingLayers(false)
          }
        }
      } catch (err) {
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'error' as const, error: (err as Error).message }
              : f
          )
        )
      }
    }

    setIsUploading(false)
    setUploadComplete(true)

    const successCount = files.filter((f) => f.status === 'uploaded').length
    if (successCount > 0) {
      toast({
        title: 'Files uploaded',
        description: `${successCount} file(s) ready for import`,
        status: 'success',
        duration: 3000,
      })
    }
  }

  const handleImport = async () => {
    if (!serviceName) return

    setImporting(true)
    const jobIds: string[] = []

    // Import each file
    for (const fileUpload of files) {
      if (fileUpload.status !== 'uploaded' || !fileUpload.filePath) continue

      setFiles((prev) =>
        prev.map((f) =>
          f.filePath === fileUpload.filePath ? { ...f, status: 'importing' as const } : f
        )
      )

      try {
        if (fileUpload.isRaster) {
          // Raster import
          const result = await api.startRasterImport({
            source_file: fileUpload.filePath,
            target_service: serviceName,
            target_schema: targetSchema,
            overwrite,
            create_index: true,
          })
          jobIds.push(result.job_id)
          setFiles((prev) =>
            prev.map((f) =>
              f.filePath === fileUpload.filePath ? { ...f, jobId: result.job_id } : f
            )
          )
        } else {
          // Vector import - import each selected layer
          const layersToImport = selectedLayers.filter((l) =>
            l.selected && fileUpload.layers?.some((fl) => fl.name === l.name)
          )

          for (const layer of layersToImport) {
            const result = await api.startVectorImport({
              source_file: fileUpload.filePath,
              target_service: serviceName,
              target_schema: targetSchema,
              table_name: layer.tableName,
              source_layer: layer.name,
              overwrite,
              target_srid: targetSRID,
            })
            jobIds.push(result.job_id)
          }
        }

        setFiles((prev) =>
          prev.map((f) =>
            f.filePath === fileUpload.filePath ? { ...f, status: 'success' as const } : f
          )
        )
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.filePath === fileUpload.filePath
              ? { ...f, status: 'error' as const, error: (err as Error).message }
              : f
          )
        )
      }
    }

    setImporting(false)

    // Poll for job completion
    if (jobIds.length > 0) {
      pollJobStatus(jobIds)
    }

    // Invalidate queries to refresh the tree
    queryClient.invalidateQueries({ queryKey: ['pgschemas', serviceName] })

    const successCount = files.filter((f) => f.status === 'success').length
    if (successCount > 0) {
      toast({
        title: 'Import started',
        description: `${successCount} file(s) queued for import`,
        status: 'success',
        duration: 3000,
      })
    }
  }

  const pollJobStatus = async (jobIds: string[]) => {
    const pendingJobs = new Set(jobIds)

    while (pendingJobs.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000))

      for (const jobId of Array.from(pendingJobs)) {
        try {
          const status = await api.getImportJobStatus(jobId)
          if (status.status === 'completed' || status.status === 'failed') {
            pendingJobs.delete(jobId)

            if (status.status === 'completed') {
              toast({
                title: 'Import completed',
                description: `Table ${status.target_table} created successfully`,
                status: 'success',
                duration: 3000,
              })
            } else {
              toast({
                title: 'Import failed',
                description: status.error || 'Unknown error',
                status: 'error',
                duration: 5000,
              })
            }
          }
        } catch (err) {
          pendingJobs.delete(jobId)
        }
      }
    }

    // Refresh after all jobs complete
    queryClient.invalidateQueries({ queryKey: ['pgschemas', serviceName] })
  }

  const toggleLayerSelection = (layerName: string) => {
    setSelectedLayers((prev) =>
      prev.map((layer) =>
        layer.name === layerName ? { ...layer, selected: !layer.selected } : layer
      )
    )
  }

  const updateLayerTableName = (layerName: string, tableName: string) => {
    setSelectedLayers((prev) =>
      prev.map((layer) =>
        layer.name === layerName ? { ...layer, tableName } : layer
      )
    )
  }

  const handleClose = () => {
    setFiles([])
    setUploadComplete(false)
    setSelectedLayers([])
    closeDialog()
  }

  const getFileIcon = (upload: FileUpload) => {
    if (upload.isRaster) return FiImage
    switch (upload.status) {
      case 'success':
        return FiCheck
      case 'error':
        return FiX
      default:
        return FiFile
    }
  }

  const getFileColor = (status: FileUpload['status']) => {
    switch (status) {
      case 'success':
        return 'green.500'
      case 'error':
        return 'red.500'
      case 'importing':
        return 'blue.500'
      default:
        return 'gray.500'
    }
  }

  const hasPendingUploads = files.some((f) => f.status === 'pending')
  const hasUploadedFiles = files.some((f) => f.status === 'uploaded')
  const selectedLayerCount = selectedLayers.filter((l) => l.selected).length

  if (!ogrStatus?.available) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} size="lg" isCentered>
        <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
        <ModalContent borderRadius="xl" overflow="hidden">
          <Box bg="linear-gradient(135deg, #667eea 0%, #764ba2 100%)" px={6} py={4}>
            <HStack spacing={3}>
              <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
                <Icon as={FiDatabase} boxSize={5} color="white" />
              </Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Import Data to PostgreSQL
              </Text>
            </HStack>
          </Box>
          <ModalCloseButton color="white" />
          <ModalBody py={6}>
            <VStack spacing={4} align="center">
              <Icon as={FiX} boxSize={12} color="red.500" />
              <Text fontWeight="600" fontSize="lg">Import Tools Not Available</Text>
              <Text color="gray.500" textAlign="center">
                ogr2ogr and raster2pgsql are required for data import.
                Please install GDAL and PostGIS on the server.
              </Text>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={handleClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden" maxH="85vh">
        {/* Gradient Header */}
        <Box
          bg="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiDatabase} boxSize={5} color="white" />
            </Box>
            <Box flex="1">
              <Text color="white" fontWeight="600" fontSize="lg">
                Import Data to PostgreSQL
              </Text>
              <HStack spacing={2}>
                <Text color="whiteAlpha.800" fontSize="sm">
                  Target:
                </Text>
                {serviceName ? (
                  <Badge bg="whiteAlpha.200" color="white" fontSize="xs">
                    {serviceName}
                  </Badge>
                ) : (
                  <Text color="whiteAlpha.600" fontSize="sm" fontStyle="italic">
                    No service selected
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
            {!uploadComplete && (
              <Box
                w="100%"
                p={8}
                bg={dropzoneBg}
                border="2px dashed"
                borderColor={dropzoneBorder}
                borderRadius="xl"
                textAlign="center"
                cursor="pointer"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                _hover={{
                  borderColor: 'purple.500',
                  bg: 'purple.50',
                }}
                transition="all 0.2s"
              >
                <VStack spacing={3}>
                  <Box bg="purple.50" p={4} borderRadius="full">
                    <Icon as={FiUploadCloud} boxSize={10} color="purple.500" />
                  </Box>
                  <VStack spacing={1}>
                    <Text fontWeight="600" color="gray.700">
                      Drop files here or click to browse
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      GeoPackage, Shapefile, GeoJSON, GeoTIFF, and more
                    </Text>
                  </VStack>
                </VStack>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".gpkg,.shp,.zip,.geojson,.json,.kml,.tif,.tiff,.gml"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
              </Box>
            )}

            {/* File list */}
            {files.length > 0 && (
              <List spacing={2} w="100%">
                {files.map((upload, index) => (
                  <ListItem
                    key={index}
                    p={3}
                    bg={dropzoneBg}
                    borderRadius="lg"
                    border="1px solid"
                    borderColor={upload.status === 'success' ? 'green.200' : upload.status === 'error' ? 'red.200' : 'gray.200'}
                  >
                    <VStack align="stretch" spacing={2}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <ListIcon
                          as={getFileIcon(upload)}
                          color={getFileColor(upload.status)}
                          boxSize={5}
                        />
                        <Text flex="1" fontSize="sm" noOfLines={1} fontWeight="500">
                          {upload.file.name}
                        </Text>
                        {upload.isRaster && (
                          <Badge colorScheme="purple" size="sm">Raster</Badge>
                        )}
                        {upload.status === 'pending' && (
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="red"
                            onClick={() => removeFile(index)}
                            borderRadius="md"
                          >
                            Remove
                          </Button>
                        )}
                        {upload.status === 'success' && (
                          <Badge colorScheme="green" borderRadius="md">Imported</Badge>
                        )}
                        {upload.status === 'importing' && (
                          <HStack>
                            <Spinner size="xs" />
                            <Badge colorScheme="blue" borderRadius="md">Importing</Badge>
                          </HStack>
                        )}
                      </Box>
                      {(upload.status === 'uploading' || upload.status === 'importing') && (
                        <Progress
                          value={upload.status === 'importing' ? undefined : upload.progress}
                          isIndeterminate={upload.status === 'importing'}
                          size="sm"
                          colorScheme="purple"
                          borderRadius="full"
                        />
                      )}
                      {upload.status === 'error' && (
                        <Text fontSize="xs" color="red.500">
                          {upload.error}
                        </Text>
                      )}
                    </VStack>
                  </ListItem>
                ))}
              </List>
            )}

            {/* Layer selection for vector files */}
            {uploadComplete && selectedLayers.length > 0 && (
              <>
                <Divider />
                <Box w="100%">
                  <HStack justify="space-between" mb={3}>
                    <HStack>
                      <Icon as={FiLayers} color="purple.500" />
                      <Text fontWeight="600">Layers to Import</Text>
                    </HStack>
                    <HStack spacing={2}>
                      <Button
                        size="xs"
                        variant="outline"
                        colorScheme="purple"
                        onClick={() => {
                          setSelectedLayers((prev) =>
                            prev.map((layer) => ({ ...layer, selected: true }))
                          )
                        }}
                        isDisabled={selectedLayers.every((l) => l.selected)}
                      >
                        Select All
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setSelectedLayers((prev) =>
                            prev.map((layer) => ({ ...layer, selected: false }))
                          )
                        }}
                        isDisabled={selectedLayers.every((l) => !l.selected)}
                      >
                        Deselect All
                      </Button>
                      <Badge colorScheme="purple">{selectedLayerCount} selected</Badge>
                    </HStack>
                  </HStack>
                  <Text fontSize="sm" color="gray.500" mb={3}>
                    All {selectedLayers.length} layer(s) detected in the file. Adjust table names if needed:
                  </Text>
                  <VStack align="stretch" spacing={2} maxH="200px" overflowY="auto">
                    {selectedLayers.map((layer) => (
                      <Box
                        key={layer.name}
                        p={2}
                        bg={dropzoneBg}
                        borderRadius="md"
                        border="1px solid"
                        borderColor={layer.selected ? 'purple.200' : 'gray.200'}
                      >
                        <HStack spacing={3}>
                          <Checkbox
                            isChecked={layer.selected}
                            onChange={() => toggleLayerSelection(layer.name)}
                            colorScheme="purple"
                          />
                          <VStack align="stretch" flex="1" spacing={1}>
                            <Text fontSize="sm" fontWeight="500">{layer.name}</Text>
                            <Input
                              size="xs"
                              value={layer.tableName}
                              onChange={(e) => updateLayerTableName(layer.name, e.target.value)}
                              placeholder="Table name"
                              isDisabled={!layer.selected}
                            />
                          </VStack>
                        </HStack>
                      </Box>
                    ))}
                  </VStack>
                </Box>
              </>
            )}

            {/* Advanced options */}
            {uploadComplete && hasUploadedFiles && (
              <>
                <Divider />
                <Box w="100%">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={showAdvanced ? <FiChevronUp /> : <FiChevronDown />}
                    rightIcon={<FiSettings />}
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    w="100%"
                    justifyContent="space-between"
                  >
                    Advanced Options
                  </Button>
                  <Collapse in={showAdvanced}>
                    <VStack spacing={4} mt={3} align="stretch" p={3} bg={dropzoneBg} borderRadius="md">
                      <FormControl>
                        <FormLabel fontSize="sm">Target Schema</FormLabel>
                        <Input
                          size="sm"
                          value={targetSchema}
                          onChange={(e) => setTargetSchema(e.target.value)}
                          placeholder="public"
                        />
                      </FormControl>
                      <FormControl>
                        <FormLabel fontSize="sm">Target SRID (leave empty to keep source)</FormLabel>
                        <Input
                          size="sm"
                          type="number"
                          value={targetSRID || ''}
                          onChange={(e) => setTargetSRID(e.target.value ? parseInt(e.target.value) : undefined)}
                          placeholder="e.g. 4326"
                        />
                      </FormControl>
                      <FormControl display="flex" alignItems="center">
                        <FormLabel fontSize="sm" mb="0">
                          Overwrite existing tables
                        </FormLabel>
                        <Switch
                          colorScheme="purple"
                          isChecked={overwrite}
                          onChange={(e) => setOverwrite(e.target.checked)}
                        />
                      </FormControl>
                    </VStack>
                  </Collapse>
                </Box>
              </>
            )}

            {/* Loading layers indicator */}
            {loadingLayers && (
              <HStack spacing={2} color="gray.500">
                <Spinner size="sm" />
                <Text fontSize="sm">Detecting layers...</Text>
              </HStack>
            )}
          </VStack>
        </ModalBody>

        <ModalFooter
          gap={3}
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          <Button variant="ghost" onClick={handleClose} borderRadius="lg">
            {uploadComplete ? 'Close' : 'Cancel'}
          </Button>

          {/* Show import button if there are uploaded files */}
          {uploadComplete && hasUploadedFiles && (
            <Button
              colorScheme="green"
              onClick={handleImport}
              isLoading={importing}
              loadingText="Importing..."
              isDisabled={selectedLayerCount === 0 && !files.some((f) => f.isRaster && f.status === 'uploaded')}
              leftIcon={<FiDatabase />}
              borderRadius="lg"
              px={6}
            >
              Import to PostgreSQL
            </Button>
          )}

          {/* Show upload button if there are pending uploads */}
          {(!uploadComplete || hasPendingUploads) && (
            <Button
              colorScheme="purple"
              onClick={handleUpload}
              isLoading={isUploading}
              loadingText="Uploading..."
              isDisabled={files.length === 0 || !serviceName || !hasPendingUploads}
              leftIcon={<FiUploadCloud />}
              borderRadius="lg"
              px={6}
            >
              Upload {files.filter((f) => f.status === 'pending').length > 0 &&
                `(${files.filter((f) => f.status === 'pending').length})`}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

import { motion, AnimatePresence } from 'framer-motion'
import {
  Button,
  VStack,
  HStack,
  Text,
  Icon,
  Box,
  Progress,
  Badge,
  Alert,
  AlertIcon,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Checkbox,
} from '@chakra-ui/react'
import { FiCheckCircle, FiAlertCircle, FiRefreshCw, FiCircle } from 'react-icons/fi'
import type { ConversionJob } from '../../types'
import { isActiveStatus, layerConversionStatuses } from '../../utils/conversionJobs'

// A row in the GeoPackage picker: a vector layer (-> PMTiles) or raster table (-> COG).
export interface GpkgItem {
  key: string
  name: string
  kind: 'vector' | 'raster'
  geometryType?: string
  featureCount?: number
}

export interface UploadResult {
  success: boolean
  message: string
  conversionJobId?: string
}

export function itemNoun(count: number, kinds: GpkgItem[]): string {
  const vector = kinds.some((item) => item.kind === 'vector')
  const raster = kinds.some((item) => item.kind === 'raster')
  const noun = vector && raster ? 'item' : raster ? 'raster table' : 'layer'
  return count === 1 ? noun : `${noun}s`
}

interface S3UploadDialogProgressProps {
  // Items of the inspected GeoPackage (null if none), and which are picked.
  gpkgItems: GpkgItem[] | null
  selectedLayerNames: Set<string>
  onSelectedLayerNamesChange: (keys: Set<string>) => void
  inLayerPickerMode: boolean
  isUploading: boolean
  uploadProgress: number
  uploadResult: UploadResult | null
  // The conversion being followed, and (for a GeoPackage) every job its
  // confirm started, the earlier ones once finished.
  conversionJob: ConversionJob | null | undefined
  conversionJobError: Error | null
  conversionJobId: string | null
  conversionJobIds: string[]
  earlierJobs: ConversionJob[]
}

// What the upload dialog shows below its form: the GeoPackage layer picker,
// the upload/conversion progress, and how they ended.
export default function S3UploadDialogProgress({
  gpkgItems,
  selectedLayerNames,
  onSelectedLayerNamesChange,
  inLayerPickerMode,
  isUploading,
  uploadProgress,
  uploadResult,
  conversionJob,
  conversionJobError,
  conversionJobId,
  conversionJobIds,
  earlierJobs,
}: S3UploadDialogProgressProps) {
  const gpkgFlowActive = !!gpkgItems
  const selectedCount = gpkgItems?.filter((item) => selectedLayerNames.has(item.key)).length ?? 0
  const hasVectorItems = !!gpkgItems?.some((item) => item.kind === 'vector')
  const hasRasterItems = !!gpkgItems?.some((item) => item.kind === 'raster')

  const toggleLayer = (key: string) => {
    const next = new Set(selectedLayerNames)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectedLayerNamesChange(next)
  }

  return (
    <>
      {/* GeoPackage layer/table picker (QGIS-style "Select Items to Add") —
          the main focus of the dialog once a GeoPackage is inspected.
          Vector layers (-> PMTiles) show geometry/feature columns;
          raster tables (-> COG) are name-only. */}
      {inLayerPickerMode && gpkgItems && (
        <Box py={2} px={6} bg="blue.50" border="1px solid" borderColor="blue.200">
          <HStack justify="space-between" mb={3}>
            <Text fontWeight="600" color="gray.700" fontSize="md">
              Select {itemNoun(2, gpkgItems)} to convert ({selectedCount}/{gpkgItems.length})
            </Text>
            <HStack spacing={1}>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onSelectedLayerNamesChange(new Set(gpkgItems.map((item) => item.key)))}
              >
                Select All
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onSelectedLayerNamesChange(new Set())}>
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
        <Box py={2} px={6} bg="blue.50" border="1px solid" borderColor="blue.200">
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

      {/* Upload Progress */}
      {isUploading && (
        <Box w="100%" py={2} px={6} bg="orange.50">
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
        <Box w="100%" py={2} px={6} bg="blue.50">
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
            <Text fontSize="xs">Unable to check conversion status: {conversionJobError.message}</Text>
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
            <Alert status="success" variant="subtle" py={2}>
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

        {conversionJob && conversionJob.status === 'cancelled' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ width: '100%' }}
          >
            <Alert status="info" borderRadius="lg" variant="subtle" py={2}>
              <AlertIcon boxSize={4} />
              <Text fontSize="xs" fontWeight="500">Conversion cancelled — nothing was published.</Text>
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
    </>
  )
}

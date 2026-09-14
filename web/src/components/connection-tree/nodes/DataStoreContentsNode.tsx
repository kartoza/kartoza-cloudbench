import { Box, Text, useToast, useColorModeValue } from '@chakra-ui/react'
import { useUIStore } from '../../../stores/uiStore'
import * as api from '../../../api'
import { DatasetRow } from '../DatasetRow'
import type { DataStoreContentsNodeProps } from '../types'

export function DataStoreContentsNode({
  connectionId,
  workspace,
  storeName,
  featureTypes,
}: DataStoreContentsNodeProps) {
  const toast = useToast()
  const setPreview = useUIStore((state) => state.setPreview)

  const handlePreviewPublished = (featureTypeName: string) => {
    api.startPreview({
      connId: connectionId,
      workspace,
      layerName: featureTypeName,
      storeName,
      storeType: 'datastore',
      layerType: 'vector',
    }).then(({ url }) => {
      setPreview({
        url,
        layerName: featureTypeName,
        workspace,
        connectionId,
        storeName,
        storeType: 'datastore',
        layerType: 'vector',
      })
    }).catch((err) => {
      toast({
        title: 'Preview failed',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    })
  }

  const bgPublished = useColorModeValue('green.50', 'green.900')

  return (
    <Box>
      {/* Published feature types */}
      {featureTypes.length > 0 && (
        <Box mb={2}>
          <Text fontSize="xs" fontWeight="600" color="gray.500" px={2} py={1}>
            Published ({featureTypes.length})
          </Text>
          {featureTypes.map((ft) => (
            <DatasetRow
              key={ft.name}
              name={ft.name}
              isPublished
              bg={bgPublished}
              onPreview={() => handlePreviewPublished(ft.name)}
            />
          ))}
        </Box>
      )}

      {featureTypes.length === 0 && (
        <Text fontSize="xs" color="gray.500" px={2} py={2} fontStyle="italic">
          No datasets in this store
        </Text>
      )}
    </Box>
  )
}

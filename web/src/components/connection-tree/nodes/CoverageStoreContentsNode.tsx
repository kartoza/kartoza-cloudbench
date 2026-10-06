import { Box, Text, useToast, useColorModeValue } from '@chakra-ui/react'
import { useUIStore } from '../../../stores/uiStore'
import * as api from '../../../api'
import { DatasetRow } from '../DatasetRow'
import { TREE_PLACEHOLDER_PL } from '../utils'
import type { CoverageStoreContentsNodeProps } from '../types'

export function CoverageStoreContentsNode({
  connectionId,
  workspace,
  storeName,
  coverages,
}: CoverageStoreContentsNodeProps) {
  const setPreview = useUIStore((state) => state.setPreview)
  const toast = useToast()

  const handlePreview = (coverageName: string) => {
    api.startPreview({
      connId: connectionId,
      workspace,
      layerName: coverageName,
      storeName,
      storeType: 'coveragestore',
      layerType: 'raster',
    }).then(({ url }) => {
      setPreview({
        url,
        layerName: coverageName,
        workspace,
        connectionId,
        storeName,
        storeType: 'coveragestore',
        layerType: 'raster',
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

  const bgPublished = useColorModeValue('purple.50', 'purple.900')

  return (
    <Box>
      {coverages.length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight="600" color="gray.500" px={2} pl={TREE_PLACEHOLDER_PL} py={1}>
            Coverages ({coverages.length})
          </Text>
          {coverages.map((cov) => (
            <DatasetRow
              key={cov.name}
              name={cov.name}
              isPublished
              isCoverage
              bg={bgPublished}
              onPreview={() => handlePreview(cov.name)}
            />
          ))}
        </Box>
      )}

      {coverages.length === 0 && (
        <Text fontSize="xs" color="gray.500" px={2} pl={TREE_PLACEHOLDER_PL} py={2} fontStyle="italic">
          No coverages in this store
        </Text>
      )}
    </Box>
  )
}

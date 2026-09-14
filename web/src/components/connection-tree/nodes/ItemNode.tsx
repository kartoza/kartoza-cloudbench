import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { DataStoreContentsNode } from './DataStoreContentsNode'
import { CoverageStoreContentsNode } from './CoverageStoreContentsNode'
import type { ItemNodeProps } from '../types'

export function ItemNode({ connectionId, workspace, name, type, storeType }: ItemNodeProps) {
  const nodeId = generateNodeId(type, connectionId, workspace, name)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setPreview = useUIStore((state) => state.setPreview)
  const setPreviewMode = useUIStore((state) => state.setPreviewMode)

  // For datastores and coveragestores, we can expand to show feature types / coverages
  const isExpandable = type === 'datastore' || type === 'coveragestore'

  // Fetch feature types for datastores
  const { data: featureTypes, isLoading: loadingFeatureTypes, error: featureTypesError } = useQuery({
    queryKey: ['featuretypes', connectionId, workspace, name],
    queryFn: () => api.getFeatureTypes(connectionId, workspace, name),
    enabled: isExpandable && type === 'datastore' && isExpanded,
    staleTime: 30000,
  })

  // Fetch coverages for coveragestores
  const { data: coverages, isLoading: loadingCoverages, error: coveragesError } = useQuery({
    queryKey: ['coverages', connectionId, workspace, name],
    queryFn: () => api.getCoverages(connectionId, workspace, name),
    enabled: isExpandable && type === 'coveragestore' && isExpanded,
    staleTime: 30000,
  })

  // Fetch available (unpublished) feature types for datastores
  const { data: availableFeatureTypes, error: availableError } = useQuery({
    queryKey: ['available-featuretypes', connectionId, workspace, name],
    queryFn: () => api.getAvailableFeatureTypes(connectionId, workspace, name),
    enabled: isExpandable && type === 'datastore' && isExpanded,
    staleTime: 30000,
  })

  // Fetch feature count for layers when selected
  const isSelected = selectedNode?.id === nodeId
  const { data: featureCount } = useQuery({
    queryKey: ['feature-count', connectionId, workspace, name],
    queryFn: () => api.getLayerFeatureCount(connectionId, workspace, name),
    enabled: type === 'layer' && isSelected,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: false,
  })

  // Log errors for debugging
  if (featureTypesError) console.error('Feature types error:', featureTypesError)
  if (coveragesError) console.error('Coverages error:', coveragesError)
  if (availableError) console.error('Available feature types error:', availableError)

  const node: TreeNode = {
    id: nodeId,
    name,
    type,
    connectionId,
    workspace,
    storeName: type === 'layer' ? undefined : name,
    storeType,
  }

  const isLoading = loadingFeatureTypes || loadingCoverages

  const handleClick = () => {
    selectNode(node)
    if (isExpandable) {
      toggleNode(nodeId)
    }
  }

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    const layerType = storeType === 'coveragestore' ? 'raster' : 'vector'
    api.startPreview({
      connId: connectionId,
      workspace,
      layerName: name,
      storeName: name,
      storeType,
      layerType,
    }).then(({ url }) => {
      setPreview({
        url,
        layerName: name,
        workspace,
        connectionId,
        storeName: name,
        storeType,
        layerType,
      })
    }).catch((err) => {
      useUIStore.getState().setError(err.message)
    })
  }

  const handleTerria = (e: React.MouseEvent) => {
    e.stopPropagation()
    const layerType = storeType === 'coveragestore' ? 'raster' : 'vector'
    setPreviewMode('3d')
    setPreview({
      url: '',
      layerName: name,
      workspace,
      connectionId,
      storeName: name,
      storeType,
      layerType,
      nodeType: type,
    })
  }

  const handleEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (type === 'style') {
      openDialog('style', {
        mode: 'edit',
        data: { connectionId, workspace, name },
      })
    } else if (type === 'layer') {
      openDialog('layer', {
        mode: 'edit',
        data: { connectionId, workspace, layerName: name, storeType },
      })
    } else if (type === 'layergroup') {
      try {
        const details = await api.getLayerGroup(connectionId, workspace, name)
        const layerNames = details.layers?.map((l) => {
          const parts = l.name.split(':')
          return parts.length > 1 ? parts[1] : l.name
        }) || []
        openDialog('layergroup', {
          mode: 'edit',
          data: {
            connectionId,
            workspace,
            name: details.name,
            title: details.title || '',
            mode: details.mode,
            layers: layerNames,
          },
        })
      } catch (err) {
        useUIStore.getState().setError((err as Error).message)
      }
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: `Delete ${type}`,
      message: `Are you sure you want to delete "${name}"?`,
      data: { connectionId, workspace, name, type },
    })
  }

  const handleDownloadConfig = (e: React.MouseEvent) => {
    e.stopPropagation()
    const resourceTypeMap: Record<string, api.DownloadResourceType> = {
      datastore: 'datastore',
      coveragestore: 'coveragestore',
      layer: 'layer',
      style: 'style',
      layergroup: 'layergroup',
    }
    const resourceType = resourceTypeMap[type]
    if (resourceType) {
      api.downloadResource(connectionId, resourceType, workspace, name)
    }
  }

  const handleDownloadData = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (type === 'layer' || storeType === 'datastore') {
      api.downloadShapefile(connectionId, workspace, name)
    } else if (storeType === 'coveragestore') {
      api.downloadGeoTiff(connectionId, workspace, name)
    }
  }

  const canDownloadConfig = ['datastore', 'coveragestore', 'layer', 'style', 'layergroup'].includes(type)
  const canDownloadData = type === 'layer'
  const downloadDataLabel = storeType === 'coveragestore' ? 'GeoTIFF' : 'Shapefile'
  const canEdit = type === 'style' || type === 'layer' || type === 'layergroup'

  const totalCount = type === 'datastore'
    ? (featureTypes?.length || 0) + (availableFeatureTypes?.length || 0)
    : type === 'coveragestore'
    ? coverages?.length
    : type === 'layer' && featureCount !== undefined && featureCount >= 0
    ? featureCount
    : undefined

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onEdit={canEdit ? handleEdit : undefined}
        onPreview={type === 'layer' || type === 'datastore' || type === 'coveragestore' ? handlePreview : undefined}
        onTerria={type === 'layer' || type === 'layergroup' ? handleTerria : undefined}
        onDownloadConfig={canDownloadConfig ? handleDownloadConfig : undefined}
        onDownloadData={canDownloadData ? handleDownloadData : undefined}
        downloadDataLabel={downloadDataLabel}
        onDelete={handleDelete}
        level={5}
        isLeaf={!isExpandable}
        count={totalCount}
      />
      {isExpanded && type === 'datastore' && (
        featureTypesError ? (
          <Text fontSize="xs" color="red.500" px={2} py={2} ml={6 * 4}>
            Error loading datasets: {(featureTypesError as Error).message}
          </Text>
        ) : (
          <DataStoreContentsNode
            connectionId={connectionId}
            workspace={workspace}
            storeName={name}
            featureTypes={featureTypes || []}
          />
        )
      )}
      {isExpanded && type === 'coveragestore' && (
        coveragesError ? (
          <Text fontSize="xs" color="red.500" px={2} py={2} ml={6 * 4}>
            Error loading coverages: {(coveragesError as Error).message}
          </Text>
        ) : (
          <CoverageStoreContentsNode
            connectionId={connectionId}
            workspace={workspace}
            storeName={name}
            coverages={coverages || []}
          />
        )
      )}
    </Box>
  )
}

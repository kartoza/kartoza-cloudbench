import { Box, Text, useToast } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import type { S3ObjectNodeProps } from '../types'

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Helper to get file extension
function getFileExtension(key: string): string {
  const parts = key.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

// Helper to determine if file is a cloud-native format
function isCloudNativeFormat(key: string): boolean {
  const ext = getFileExtension(key)
  return ['cog', 'copc', 'parquet', 'geoparquet'].includes(ext) ||
    key.endsWith('.copc.laz') ||
    key.endsWith('.copc.las')
}

// Helper to determine if file is previewable in the map viewer
function isMapPreviewable(key: string): boolean {
  const ext = getFileExtension(key)
  const keyLower = key.toLowerCase()
  // COG and GeoTIFF (raster)
  if (['tif', 'tiff', 'cog', 'gtiff', 'geotiff'].includes(ext)) return true
  // Point clouds
  if (['las', 'laz', 'copc'].includes(ext) || keyLower.endsWith('.copc.laz') || keyLower.endsWith('.copc.las')) return true
  // Vector formats
  if (['geojson', 'parquet', 'geoparquet', 'json', 'gpkg'].includes(ext)) return true
  return false
}

export function S3ObjectNode({ connectionId, bucket, object }: S3ObjectNodeProps) {
  const nodeId = generateNodeId('s3object', connectionId, bucket, object.key)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setS3Preview = useUIStore((state) => state.setS3Preview)
  const toast = useToast()
  const queryClient = useQueryClient()

  // If this is a folder, fetch children when expanded
  const { data: children, isLoading } = useQuery({
    queryKey: ['s3objects', connectionId, bucket, object.key],
    queryFn: () => api.getS3Objects(connectionId, bucket, object.key),
    enabled: object.isFolder && isExpanded,
    staleTime: 30000,
  })

  // Get display name (just the filename, not full path)
  const displayName = object.key.split('/').filter(Boolean).pop() || object.key

  const node: TreeNode = {
    id: nodeId,
    name: displayName,
    type: object.isFolder ? 's3folder' : 's3object',
    s3ConnectionId: connectionId,
    s3Bucket: bucket,
    s3Key: object.key,
    s3Size: object.size,
    s3ContentType: object.contentType,
    s3IsFolder: object.isFolder,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    if (object.isFolder) {
      toggleNode(nodeId)
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: object.isFolder ? 'Delete Folder' : 'Delete Object',
      message: object.isFolder
        ? `Are you sure you want to delete folder "${displayName}" and all its contents?`
        : `Are you sure you want to delete "${displayName}"?`,
      data: { s3ConnectionId: connectionId, s3BucketName: bucket, s3ObjectKey: object.key },
    })
  }

  const handlePreview = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      // Use the integrated S3LayerPreview component for map-previewable formats
      setS3Preview({
        connectionId,
        bucketName: bucket,
        objectKey: object.key,
      })
    } catch (err) {
      toast({
        title: 'Preview Failed',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    }
  }

  const handleDownloadData = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const result = await api.getS3PresignedURL(connectionId, bucket, object.key, 60)
      // Create a temporary link and trigger download
      const link = document.createElement('a')
      link.href = result.url
      link.download = displayName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      toast({
        title: 'Download Failed',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    }
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId, bucket, object.key] })
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onDelete={handleDelete}
        onPreview={!object.isFolder && isMapPreviewable(object.key) ? handlePreview : undefined}
        onDownloadData={!object.isFolder ? handleDownloadData : undefined}
        downloadDataLabel={displayName}
        onRefresh={object.isFolder ? handleRefresh : undefined}
        level={4}
        isLeaf={!object.isFolder}
        count={object.isFolder && children ? children.length : undefined}
      />
      {/* Show metadata for files */}
      {isSelected && !object.isFolder && (
        <Box pl={10} py={1}>
          <Text fontSize="xs" color="gray.500">
            Size: {formatFileSize(object.size)} | Modified: {new Date(object.lastModified).toLocaleString()}
            {isCloudNativeFormat(object.key) && (
              <Text as="span" color="green.500" ml={2}>
                Cloud-Native
              </Text>
            )}
          </Text>
        </Box>
      )}
      {/* Show folder children */}
      {object.isFolder && isExpanded && children && (
        <Box pl={4}>
          {children.length === 0 ? (
            <Box px={2} py={1}>
              <Text fontSize="xs" color="gray.400">
                Empty folder
              </Text>
            </Box>
          ) : (
            children.map((child) => (
              <S3ObjectNode
                key={child.key}
                connectionId={connectionId}
                bucket={bucket}
                object={child}
                prefix={object.key}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

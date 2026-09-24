import { Box, Text, useToast } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import type { S3ObjectNodeProps } from '../types'
import { isMapExplorerFormat, isMapPreviewable, isQueryable } from '../../../utils/s3ObjectFormat'

function isReadme(key: string): boolean {
  return /^readme\.md$/i.test(key.split('/').filter(Boolean).pop() || '')
}

export function S3ObjectNode({ connectionId, bucket, object }: S3ObjectNodeProps) {
  const nodeId = generateNodeId('s3object', connectionId, bucket, object.key)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setS3Preview = useUIStore((state) => state.setS3Preview)
  const setS3MapPreview = useUIStore((state) => state.setS3MapPreview)
  const setS3TextPreview = useUIStore((state) => state.setS3TextPreview)
  const setDuckDBQuery = useUIStore((state) => state.setDuckDBQuery)
  const clearPreviews = useUIStore((state) => state.clearPreviews)
  const toast = useToast()
  const queryClient = useQueryClient()

  // If this is a folder, fetch children when expanded
  const { data: children, isLoading } = useQuery({
    queryKey: ['s3objects', connectionId, object.key],
    queryFn: () => api.getS3Objects(connectionId, object.key),
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
    s3IsFolder: object.isFolder,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleFolderClick = async () => {
    selectNode(node)
    toggleNode(nodeId)

    // A folder with its own README.md shows that instead of the listing —
    // same idea as a GitHub repo folder.
    try {
      const items = await queryClient.fetchQuery({
        queryKey: ['s3objects', connectionId, object.key],
        queryFn: () => api.getS3Objects(connectionId, object.key),
        staleTime: 30000,
      })
      const readme = items.find((item) => !item.isFolder && isReadme(item.key))
      if (readme) {
        setS3TextPreview({
          connectionId,
          objectKey: readme.key,
          title: `${displayName} - README`,
          size: readme.size,
          lastModified: readme.lastModified,
        })
      } else {
        clearPreviews()
      }
    } catch {
      clearPreviews()
    }
  }

  const handleFileClick = () => {
    selectNode(node)
    if (isMapExplorerFormat(object.key)) {
      setS3MapPreview({
        connectionId,
        bucketName: bucket,
        objectKey: object.key,
        format: object.key.toLowerCase().endsWith('.pmtiles') ? 'pmtiles' : 'cog',
      })
    } else if (isMapPreviewable(object.key)) {
      setS3Preview({ connectionId, bucketName: bucket, objectKey: object.key })
    } else {
      setS3TextPreview({
        connectionId,
        objectKey: object.key,
        title: displayName,
        size: object.size,
        lastModified: object.lastModified,
      })
    }
  }

  const handleClick = () => {
    if (object.isFolder) {
      handleFolderClick()
    } else {
      handleFileClick()
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
      data: { s3ConnectionId: connectionId, s3ObjectKey: object.key },
    })
  }

  const handleDownloadData = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const result = await api.getS3PresignedURL(connectionId, object.key)
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
    queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId, object.key] })
  }

  const handleQuery = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDuckDBQuery({
      connectionId,
      bucketName: bucket,
      objectKey: object.key,
      displayName,
    })
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
        onQuery={!object.isFolder && isQueryable(object.key) ? handleQuery : undefined}
        onDownloadData={!object.isFolder ? handleDownloadData : undefined}
        downloadDataLabel={displayName}
        onRefresh={object.isFolder ? handleRefresh : undefined}
        level={4}
        isLeaf={!object.isFolder}
        count={object.isFolder && children ? children.length : undefined}
      />
      {object.isFolder && isExpanded && children && (
        <>
          {children.length === 0 ? (
            <Box px={2} py={1} ml={5 * 4}>
              <Text fontSize="xs" color="gray.400">
                Empty folder
              </Text>
            </Box>
          ) : (
            children.map((child) => (
              <S3ObjectNode key={child.key} connectionId={connectionId} bucket={bucket} object={child} />
            ))
          )}
        </>
      )}
    </Box>
  )
}

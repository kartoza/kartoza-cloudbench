import { Box, Text } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import { S3ObjectNode } from './S3ObjectNode'
import type { S3BucketNodeProps } from '../types'

export function S3BucketNode({ connectionId, bucket }: S3BucketNodeProps) {
  const nodeId = generateNodeId('s3bucket', connectionId, bucket.name)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const queryClient = useQueryClient()

  // Fetch objects when expanded (root level)
  const { data: objects, isLoading } = useQuery({
    queryKey: ['s3objects', connectionId, bucket.name, ''],
    queryFn: () => api.getS3Objects(connectionId, bucket.name),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: bucket.name,
    type: 's3bucket',
    s3ConnectionId: connectionId,
    s3Bucket: bucket.name,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete S3 Bucket',
      message: `Are you sure you want to delete bucket "${bucket.name}"? This will delete all objects in the bucket.`,
      data: { s3ConnectionId: connectionId, s3BucketName: bucket.name },
    })
  }

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('s3upload', {
      mode: 'create',
      data: { connectionId, bucketName: bucket.name },
    })
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['s3objects', connectionId, bucket.name] })
  }

  // Format creation date
  const createdDate = new Date(bucket.creationDate).toLocaleDateString()

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onDelete={handleDelete}
        onUpload={handleUpload}
        onRefresh={handleRefresh}
        level={3}
        count={objects?.length}
      />
      {isExpanded && (
        <Box pl={4}>
          {!objects || objects.length === 0 ? (
            <Box px={2} py={2}>
              <Text fontSize="xs" color="gray.500">
                Created: {createdDate}
              </Text>
              <Text fontSize="xs" color="gray.400" mt={1}>
                Empty bucket. Upload files to get started.
              </Text>
            </Box>
          ) : (
            objects.map((obj) => (
              <S3ObjectNode
                key={obj.key}
                connectionId={connectionId}
                bucket={bucket.name}
                object={obj}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

import { Box, Text } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import { S3BucketNode } from './S3BucketNode'
import type { S3ConnectionNodeProps } from '../types'

export function S3ConnectionNode({ connection }: S3ConnectionNodeProps) {
  const nodeId = generateNodeId('s3connection', connection.id)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const queryClient = useQueryClient()

  // Fetch buckets when expanded
  const { data: buckets, isLoading } = useQuery({
    queryKey: ['s3buckets', connection.id],
    queryFn: () => api.getS3Buckets(connection.id),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: connection.name,
    type: 's3connection',
    s3ConnectionId: connection.id,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('s3connection', {
      mode: 'edit',
      data: { connectionId: connection.id },
    })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete S3 Connection',
      message: `Are you sure you want to delete "${connection.name}"?`,
      data: { s3ConnectionId: connection.id },
    })
  }

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('s3upload', {
      mode: 'create',
      data: { connectionId: connection.id },
    })
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['s3buckets', connection.id] })
  }

  const subtitle = connection.endpoint

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onUpload={handleUpload}
        onRefresh={handleRefresh}
        level={2}
        count={buckets?.length}
      />
      {isExpanded && (
        <Box pl={4}>
          {!buckets || buckets.length === 0 ? (
            <Box px={2} py={2}>
              <Text fontSize="xs" color="gray.500">
                {subtitle}
              </Text>
              <Text fontSize="xs" color="gray.400" mt={1}>
                No buckets found. Create one to start uploading.
              </Text>
            </Box>
          ) : (
            buckets.map((bucket) => (
              <S3BucketNode
                key={bucket.name}
                connectionId={connection.id}
                bucket={bucket}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

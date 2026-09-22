import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import * as api from '../../../api'
import type { TreeNode } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import { S3ObjectNode } from './S3ObjectNode'
import type { S3ConnectionNodeProps } from '../types'

// A connection is scoped to one bucket. Selecting it opens the full bucket
// browser in the main panel; expanding it browses the bucket's contents
// right here in the tree (see S3ObjectNode for per-item behavior).
export function S3ConnectionNode({ connection }: S3ConnectionNodeProps) {
  const nodeId = generateNodeId('s3connection', connection.id)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const clearPreviews = useUIStore((state) => state.clearPreviews)

  const { data: children, isLoading } = useQuery({
    queryKey: ['s3objects', connection.id, ''],
    queryFn: () => api.getS3Objects(connection.id, ''),
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
    clearPreviews()
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
        level={2}
        count={children ? children.length : undefined}
      />
      {isExpanded && children && (
        <>
          {children.length === 0 ? (
            <Box px={2} py={1} ml={5 * 3}>
              <Text fontSize="xs" color="gray.400">
                Empty bucket
              </Text>
            </Box>
          ) : (
            children.map((child) => (
              <S3ObjectNode key={child.key} connectionId={connection.id} bucket={connection.bucket} object={child} />
            ))
          )}
        </>
      )}
    </Box>
  )
}

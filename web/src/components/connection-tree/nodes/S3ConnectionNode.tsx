import { Box } from '@chakra-ui/react'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import type { S3ConnectionNodeProps } from '../types'

// A connection is scoped to one bucket. Its objects are browsed in the main
// panel (S3ConnectionPanel), not expanded here in the tree.
export function S3ConnectionNode({ connection }: S3ConnectionNodeProps) {
  const nodeId = generateNodeId('s3connection', connection.id)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const node: TreeNode = {
    id: nodeId,
    name: connection.name,
    type: 's3connection',
    s3ConnectionId: connection.id,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
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
        isExpanded={false}
        isSelected={isSelected}
        isLoading={false}
        isLeaf
        onClick={handleClick}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onUpload={handleUpload}
        level={2}
      />
    </Box>
  )
}

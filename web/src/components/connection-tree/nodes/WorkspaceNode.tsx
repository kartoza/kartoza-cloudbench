import { Box } from '@chakra-ui/react'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { TreeChildren } from '../TreeChildren'
import { CategoryNode } from './CategoryNode'
import type { WorkspaceNodeProps } from '../types'

export function WorkspaceNode({ connectionId, workspace }: WorkspaceNodeProps) {
  const nodeId = generateNodeId('workspace', connectionId, workspace)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const node: TreeNode = {
    id: nodeId,
    name: workspace,
    type: 'workspace',
    connectionId,
    workspace,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('workspace', { mode: 'edit', data: { connectionId, workspace } })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete Workspace',
      message: `Are you sure you want to delete workspace "${workspace}"?`,
      data: { connectionId, workspace },
    })
  }

  const handleDownloadConfig = (e: React.MouseEvent) => {
    e.stopPropagation()
    api.downloadResource(connectionId, 'workspace', workspace)
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        onEdit={handleEdit}
        onDownloadConfig={handleDownloadConfig}
        onDelete={handleDelete}
        level={3}
      />
      {isExpanded && (
        <TreeChildren>
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="datastores"
            label="Data Stores"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="coveragestores"
            label="Coverage Stores"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="layers"
            label="Layers"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="styles"
            label="Styles"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="layergroups"
            label="Layer Groups"
          />
        </TreeChildren>
      )}
    </Box>
  )
}

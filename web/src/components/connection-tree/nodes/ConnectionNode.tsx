import { Box } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { WorkspaceNode } from './WorkspaceNode'
import type { ConnectionNodeProps } from '../types'
import { useOnlineStatus } from '../../../hooks/useOnlineStatus'
import { API_BASE } from "../../../api";

export function ConnectionNode({ connectionId, name, url, ableToEdit = true, ableToDelete = true }: ConnectionNodeProps) {
  const nodeId = generateNodeId('connection', connectionId)
  const isOnline = useOnlineStatus(`${API_BASE}/connections/${connectionId}/test`)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces', connectionId],
    queryFn: () => api.getWorkspaces(connectionId),
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name,
    type: 'connection',
    connectionId,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    if (isOnline === false) return
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('connection', { mode: 'edit', data: { connectionId } })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete Connection',
      message: `Are you sure you want to delete connection "${name}"?`,
      data: { connectionId },
    })
  }

  const handleOpenAdmin = (e: React.MouseEvent) => {
    e.stopPropagation()
    // GeoServer admin URL is typically the base URL + /web
    const adminUrl = url.replace(/\/rest\/?$/, '/web')
    window.open(adminUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        isOnline={isOnline}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onOpenAdmin={handleOpenAdmin}
        level={2}
        count={workspaces?.length}
        ableToEdit={ableToEdit}
        ableToDelete={ableToDelete}
      />
      {isExpanded && workspaces && workspaces.map((ws) => (
        <WorkspaceNode
          key={ws.name}
          connectionId={connectionId}
          workspace={ws.name}
        />
      ))}
    </Box>
  )
}

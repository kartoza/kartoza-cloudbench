import { Box, Text } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode, IcebergNamespace } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { IcebergTableNode } from './IcebergTableNode'
import { TREE_PLACEHOLDER_PL } from '../utils'
import { TreeChildren } from '../TreeChildren'

interface IcebergNamespaceNodeProps {
  connectionId: string
  connectionName: string
  namespace: IcebergNamespace
}

export function IcebergNamespaceNode({ connectionId, connectionName, namespace }: IcebergNamespaceNodeProps) {
  const nodeId = generateNodeId('icebergnamespace', `${connectionId}:${namespace.name}`)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const queryClient = useQueryClient()

  // Fetch tables when expanded
  const { data: tables, isLoading } = useQuery({
    queryKey: ['icebergtables', connectionId, namespace.name],
    queryFn: () => api.getIcebergTables(connectionId, namespace.name),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: namespace.name,
    type: 'icebergnamespace',
    icebergConnectionId: connectionId,
    icebergNamespace: namespace.name,
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
      title: 'Delete Namespace',
      message: `Are you sure you want to delete namespace "${namespace.name}"? This will also delete all tables in it.`,
      data: {
        icebergConnectionId: connectionId,
        icebergNamespace: namespace.name,
      },
    })
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['icebergtables', connectionId, namespace.name] })
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('icebergtable', {
      mode: 'create',
      data: {
        connectionId,
        connectionName,
        namespace: namespace.name,
      },
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
        onAdd={handleAdd}
        onDelete={handleDelete}
        onRefresh={handleRefresh}
        level={3}
        count={tables?.length}
      />
      {isExpanded && (
        <TreeChildren>
          {!tables || tables.length === 0 ? (
            <Box px={2} pl={TREE_PLACEHOLDER_PL} py={1.5}>
              <Text fontSize="xs" color="gray.400">
                No tables in this namespace.
              </Text>
            </Box>
          ) : (
            tables.map((table) => (
              <IcebergTableNode
                key={table.name}
                connectionId={connectionId}
                connectionName={connectionName}
                namespace={namespace.name}
                table={table}
              />
            ))
          )}
        </TreeChildren>
      )}
    </Box>
  )
}

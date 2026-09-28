import { Box, Text, useToast } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode, IcebergConnection } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { IcebergNamespaceNode } from './IcebergNamespaceNode'
import { treeIndent, TREE_PLACEHOLDER_PL } from '../utils'

interface IcebergConnectionNodeProps {
  connection: IcebergConnection
}

export function IcebergConnectionNode({ connection }: IcebergConnectionNodeProps) {
  const nodeId = generateNodeId('icebergconnection', connection.id)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setJupyterPreview = useUIStore((state) => state.setJupyterPreview)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Fetch namespaces when expanded
  const { data: namespaces, isLoading } = useQuery({
    queryKey: ['icebergnamespaces', connection.id],
    queryFn: () => api.getIcebergNamespaces(connection.id),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: connection.name,
    type: 'icebergconnection',
    icebergConnectionId: connection.id,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('icebergconnection', {
      mode: 'edit',
      data: { connectionId: connection.id },
    })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete Iceberg Catalog',
      message: `Are you sure you want to delete "${connection.name}"?`,
      data: { icebergConnectionId: connection.id },
    })
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('icebergnamespace', {
      mode: 'create',
      data: { connectionId: connection.id, connectionName: connection.name },
    })
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['icebergnamespaces', connection.id] })
  }

  const handleJupyter = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (connection.jupyterUrl) {
      setJupyterPreview({
        connectionId: connection.id,
        connectionName: connection.name,
        jupyterUrl: connection.jupyterUrl,
      })
    } else {
      toast({
        title: 'No Jupyter URL configured',
        description: 'Edit the connection to add a Jupyter URL',
        status: 'warning',
        duration: 3000,
      })
    }
  }

  const subtitle = connection.url

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onRefresh={handleRefresh}
        onJupyter={handleJupyter}
        level={2}
        count={namespaces?.length}
      />
      {isExpanded && (
        <>
          {!namespaces || namespaces.length === 0 ? (
            <Box px={2} pl={TREE_PLACEHOLDER_PL} py={1.5} ml={treeIndent(3)}>
              <Text fontSize="xs" color="gray.500">
                {subtitle}
              </Text>
              <Text fontSize="xs" color="gray.400" mt={1}>
                No namespaces found. Click + to create one.
              </Text>
            </Box>
          ) : (
            namespaces.map((ns) => (
              <IcebergNamespaceNode
                key={ns.name}
                connectionId={connection.id}
                connectionName={connection.name}
                namespace={ns}
              />
            ))
          )}
        </>
      )}
    </Box>
  )
}

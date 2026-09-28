import { useEffect } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { IcebergConnectionNode } from './IcebergConnectionNode'
import { treeIndent, TREE_PLACEHOLDER_PL } from '../utils'

export function IcebergRootNode() {
  const nodeId = 'iceberg-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  // Fetch Iceberg connections
  const { data: icebergConnections, isLoading } = useQuery({
    queryKey: ['icebergconnections'],
    queryFn: () => api.getIcebergConnections(),
    staleTime: 30000,
  })

  // Auto-expand Iceberg section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'Apache Iceberg',
    type: 'iceberg',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('icebergconnection', { mode: 'create' })
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
        level={1}
        count={icebergConnections?.length}
      />
      {isExpanded && (
        <>
          {!icebergConnections || icebergConnections.length === 0 ? (
            <Box px={2} pl={TREE_PLACEHOLDER_PL} py={1.5} ml={treeIndent(2)}>
              <Text color="gray.500" fontSize="sm">
                No Iceberg catalogs. Click + to add one.
              </Text>
            </Box>
          ) : (
            icebergConnections.map((conn) => (
              <IcebergConnectionNode
                key={conn.id}
                connection={conn}
              />
            ))
          )}
        </>
      )}
    </Box>
  )
}

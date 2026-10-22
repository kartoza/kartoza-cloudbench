import { useEffect } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import { MerginMapsConnectionNode } from './MerginMapsConnectionNode'
import { TREE_PLACEHOLDER_PL } from '../utils'
import { TreeChildren } from '../TreeChildren'

export function MerginMapsRootNode() {
  const nodeId = 'merginmaps-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  // Fetch Mergin Maps connections
  const { data: connections, isLoading } = useQuery({
    queryKey: ['merginmapsconnections'],
    queryFn: () => api.getMerginMapsConnections(),
    staleTime: 30000,
  })

  // Auto-expand Mergin Maps section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'Mergin Maps',
    type: 'merginmaps',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('merginmaps', { mode: 'create', data: {} })
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
        count={connections?.length}
      />
      {isExpanded && (
        <TreeChildren>
          {!connections || connections.length === 0 ? (
            <Box px={2} pl={TREE_PLACEHOLDER_PL} py={1.5}>
              <Text color="gray.500" fontSize="sm">
                No Mergin Maps connections. Click + to add one.
              </Text>
            </Box>
          ) : (
            connections.map((connection) => (
              <MerginMapsConnectionNode
                key={connection.id}
                connection={connection}
              />
            ))
          )}
        </TreeChildren>
      )}
    </Box>
  )
}

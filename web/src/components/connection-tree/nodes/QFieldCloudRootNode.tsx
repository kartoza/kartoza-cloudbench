import { useEffect } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import { QFieldCloudConnectionNode } from './QFieldCloudConnectionNode'
import { TREE_PLACEHOLDER_PL } from '../utils'
import { TreeChildren } from '../TreeChildren'

export function QFieldCloudRootNode() {
  const nodeId = 'qfieldcloud-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: connections, isLoading } = useQuery({
    queryKey: ['qfieldcloudconnections'],
    queryFn: () => api.getQFieldCloudConnections(),
    staleTime: 30000,
  })

  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const node: TreeNode = {
    id: nodeId,
    name: 'QFieldCloud',
    type: 'qfieldcloud',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('qfieldcloud', { mode: 'create', data: {} })
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
                No QFieldCloud connections. Click + to add one.
              </Text>
            </Box>
          ) : (
            connections.map((connection) => (
              <QFieldCloudConnectionNode
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

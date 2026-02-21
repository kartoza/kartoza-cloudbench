import { useEffect } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import { ConnectionNode } from './ConnectionNode'

interface GeoServerRootNodeProps {
  connections: { id: string; name: string; url: string }[]
}

export function GeoServerRootNode({ connections }: GeoServerRootNodeProps) {
  const nodeId = 'geoserver-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  // Auto-expand GeoServer section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'GeoServer',
    type: 'geoserver',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('connection', { mode: 'create' })
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        onAdd={handleAdd}
        level={1}
        count={connections.length}
      />
      {isExpanded && (
        <Box pl={4}>
          {connections.length === 0 ? (
            <Box px={2} py={3}>
              <Text color="gray.500" fontSize="sm">
                No connections yet. Click + to add one.
              </Text>
            </Box>
          ) : (
            connections.map((conn) => (
              <ConnectionNode
                key={conn.id}
                connectionId={conn.id}
                name={conn.name}
                url={conn.url}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

import { useEffect } from 'react'
import { Box, Text, useToast } from '@chakra-ui/react'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import { useConnectionStore } from '../../../stores/connectionStore'
import type { Connection, TreeNode } from '../../../types'
import { getCreateGeoServerUrl } from '../../../config/env'
import { openWindowWithCallback } from '../../../utils/openWindowWithCallback'
import { TreeNodeRow } from '../TreeNodeRow'
import { ConnectionNode } from './ConnectionNode'

export function GeoServerRootNode() {
  const nodeId = 'geoserver'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const createUrl = getCreateGeoServerUrl()
  const toast = useToast()

  const connections = useConnectionStore((state) => state.connections)
  const isLoading = useConnectionStore((state) => state.isLoading)
  const fetchConnections = useConnectionStore((state) => state.fetchConnections)

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
    if (createUrl) {
      openWindowWithCallback(createUrl, () => {
        void fetchConnections()
      }, toast)
    } else {
      openDialog('connection', { mode: 'create' })
    }
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
        <>
          {!connections || connections.length === 0 ? (
            <Box px={2} py={3} ml={2 * 4}>
              <Text color="gray.500" fontSize="sm">
                No GeoServer connections found.
              </Text>
            </Box>
          ) : (
            connections.map((conn: Connection) => (
              <ConnectionNode
                key={conn.id}
                connectionId={conn.id}
                name={conn.name}
                url={conn.url}
                ableToDelete={!createUrl}
              />
            ))
          )}
        </>
      )}
    </Box>
  )
}

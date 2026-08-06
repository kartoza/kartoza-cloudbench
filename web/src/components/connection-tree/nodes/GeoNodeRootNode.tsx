import { useEffect } from 'react'
import { Box, Text, useToast } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { getCreateGeoNodeUrl } from '../../../config/env'
import { openWindowWithCallback } from '../../../utils/openWindowWithCallback'
import { TreeNodeRow } from '../TreeNodeRow'
import { GeoNodeConnectionNode } from './GeoNodeConnectionNode'

export function GeoNodeRootNode() {
  const nodeId = 'geonode-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const toast = useToast()

  // Fetch GeoNode connections
  const { data: connections, isLoading, refetch } = useQuery({
    queryKey: ['geonodeconnections'],
    queryFn: () => api.getGeoNodeConnections(),
    staleTime: 30000,
  })

  // Auto-expand GeoNode section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'GeoNode',
    type: 'geonode',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    const createUrl = getCreateGeoNodeUrl()
    if (createUrl) {
      openWindowWithCallback(createUrl, () => refetch(), toast)
    } else {
      openDialog('geonode', { mode: 'create', data: {} })
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
                No GeoNode connections found.
              </Text>
            </Box>
          ) : (
            connections.map((connection) => (
              <GeoNodeConnectionNode
                key={connection.id}
                connection={connection}
              />
            ))
          )}
        </>
      )}
    </Box>
  )
}

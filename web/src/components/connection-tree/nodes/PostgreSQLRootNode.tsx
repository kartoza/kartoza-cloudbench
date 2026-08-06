import { useEffect } from 'react'
import { Box, Text, useToast } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { getCreatePostGISUrl } from '../../../config/env'
import { openWindowWithCallback } from '../../../utils/openWindowWithCallback'
import { TreeNodeRow } from '../TreeNodeRow'
import { PGServiceNode } from './PGServiceNode'

export function PostgreSQLRootNode() {
  const nodeId = 'postgresql'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const showHiddenPGServices = useUIStore((state) => state.settings.showHiddenPGServices)
  const createUrl = getCreatePostGISUrl()

  // Fetch PostgreSQL services
  const { data: pgServices, isLoading, refetch } = useQuery({
    queryKey: ['pgservices'],
    queryFn: () => api.getPGServices(),
    staleTime: 30000,
  })

  // Filter hidden services based on setting
  const filteredPGServices = pgServices?.filter(
    (service) => showHiddenPGServices || !service.hidden
  )

  // Auto-expand PostgreSQL section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'PostgreSQL',
    type: 'postgresql',
  }

  const isSelected = selectedNode?.id === nodeId

  const openDialog = useUIStore((state) => state.openDialog)
  const toast = useToast()

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (createUrl) {
      openWindowWithCallback(createUrl, () => refetch(), toast)
    } else {
      openDialog('pgdashboard', { mode: 'create' })
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
        count={filteredPGServices?.length}
      />
      {isExpanded && (
        <>
          {!filteredPGServices || filteredPGServices.length === 0 ? (
            <Box px={2} py={3} ml={2 * 4}>
              <Text color="gray.500" fontSize="sm">
                No PostgreSQL connections found.
              </Text>
            </Box>
          ) : (
            filteredPGServices.map((svc) => (
              <PGServiceNode
                key={svc.name}
                service={svc}
                ableToDelete={!createUrl}
              />
            ))
          )}
        </>
      )}
    </Box>
  )
}

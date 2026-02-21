import { useEffect } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import { S3ConnectionNode } from './S3ConnectionNode'

export function S3StorageRootNode() {
  const nodeId = 's3storage-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  // Fetch S3 connections
  const { data: s3Connections, isLoading } = useQuery({
    queryKey: ['s3connections'],
    queryFn: () => api.getS3Connections(),
    staleTime: 30000,
  })

  // Auto-expand S3 Storage section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'S3 Storage',
    type: 's3storage',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('s3connection', { mode: 'create' })
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
        count={s3Connections?.length}
      />
      {isExpanded && (
        <Box pl={4}>
          {!s3Connections || s3Connections.length === 0 ? (
            <Box px={2} py={3}>
              <Text color="gray.500" fontSize="sm">
                No S3 connections. Click + to add one.
              </Text>
            </Box>
          ) : (
            s3Connections.map((conn) => (
              <S3ConnectionNode
                key={conn.id}
                connection={conn}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

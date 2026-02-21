import { useEffect } from 'react'
import { Box } from '@chakra-ui/react'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import { GeoServerRootNode } from './GeoServerRootNode'
import { PostgreSQLRootNode } from './PostgreSQLRootNode'
import { S3StorageRootNode } from './S3StorageRootNode'

interface CloudBenchRootNodeProps {
  connections: { id: string; name: string; url: string }[]
}

export function CloudBenchRootNode({ connections }: CloudBenchRootNodeProps) {
  const nodeId = 'cloudbench-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const instanceName = useUIStore((state) => state.settings.instanceName)

  // Auto-expand root on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: instanceName,
    type: 'cloudbench',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        level={0}
      />
      {isExpanded && (
        <Box pl={4}>
          {/* GeoServer Section */}
          <GeoServerRootNode connections={connections} />
          {/* PostgreSQL Section */}
          <PostgreSQLRootNode />
          {/* S3 Storage Section */}
          <S3StorageRootNode />
        </Box>
      )}
    </Box>
  )
}

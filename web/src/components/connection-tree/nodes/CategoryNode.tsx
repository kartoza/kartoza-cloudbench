import { Box } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import type { TreeNode, NodeType } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { TreeChildren } from '../TreeChildren'
import { ItemNode } from './ItemNode'
import type { CategoryNodeProps } from '../types'

export function CategoryNode({ connectionId, workspace, category, label }: CategoryNodeProps) {
  const nodeId = generateNodeId(category, connectionId, workspace)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const { data: items, isLoading } = useQuery({
    queryKey: [category, connectionId, workspace],
    queryFn: async (): Promise<{ name: string }[]> => {
      switch (category) {
        case 'datastores':
          return api.getDataStores(connectionId, workspace)
        case 'coveragestores':
          return api.getCoverageStores(connectionId, workspace)
        case 'layers':
          return api.getLayers(connectionId, workspace)
        case 'styles':
          return api.getStyles(connectionId, workspace)
        case 'layergroups':
          return api.getLayerGroups(connectionId, workspace)
      }
    },
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: label,
    type: category,
    connectionId,
    workspace,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const getChildType = (): NodeType => {
    switch (category) {
      case 'datastores':
        return 'datastore'
      case 'coveragestores':
        return 'coveragestore'
      case 'layers':
        return 'layer'
      case 'styles':
        return 'style'
      case 'layergroups':
        return 'layergroup'
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
        level={4}
        count={items?.length}
      />
      {isExpanded && items && (
        <TreeChildren>
          {items.map((item) => (
            <ItemNode
              key={item.name}
              connectionId={connectionId}
              workspace={workspace}
              name={item.name}
              type={getChildType()}
              storeType={category === 'coveragestores' ? 'coveragestore' : category === 'datastores' ? 'datastore' : undefined}
            />
          ))}
        </TreeChildren>
      )}
    </Box>
  )
}

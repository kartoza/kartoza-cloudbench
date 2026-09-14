import { Box, Text } from '@chakra-ui/react'
import { useTreeStore } from '../../../stores/treeStore'
import type { TreeNode, NodeType, GeoNodeResource } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import { GeoNodeResourceNode } from './GeoNodeResourceNode'

type CategoryType = 'datasets' | 'maps' | 'documents' | 'geostories' | 'dashboards'

interface GeoNodeResourceCategoryNodeProps {
  connectionId: string
  connectionUrl: string
  category: CategoryType
  name: string
  resources: GeoNodeResource[]
  total: number
  isLoading: boolean
  onUpload?: (e: React.MouseEvent) => void
}

const categoryToNodeType: Record<CategoryType, NodeType> = {
  datasets: 'geonodedatasets',
  maps: 'geonodemaps',
  documents: 'geonodedocuments',
  geostories: 'geonodegeostories',
  dashboards: 'geonodedashboards',
}

const categoryToItemType: Record<CategoryType, NodeType> = {
  datasets: 'geonodedataset',
  maps: 'geonodemap',
  documents: 'geonodedocument',
  geostories: 'geonodegeostory',
  dashboards: 'geonodedashboard',
}

export function GeoNodeResourceCategoryNode({
  connectionId,
  connectionUrl,
  category,
  name,
  resources,
  total,
  isLoading,
  onUpload
}: GeoNodeResourceCategoryNodeProps) {
  const nodeId = `geonode-${category}-${connectionId}`
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const node: TreeNode = {
    id: nodeId,
    name: name,
    type: categoryToNodeType[category],
    geonodeConnectionId: connectionId,
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
        isLoading={isLoading}
        onClick={handleClick}
        level={3}
        count={total}
        onUpload={onUpload}
      />
      {isExpanded && (
        <>
          {resources.length === 0 ? (
            <Box px={2} py={2} ml={4 * 4}>
              <Text color="gray.500" fontSize="sm">
                No {name.toLowerCase()} found
              </Text>
            </Box>
          ) : (
            resources.map((resource) => (
              <GeoNodeResourceNode
                key={resource.pk}
                connectionId={connectionId}
                connectionUrl={connectionUrl}
                resource={resource}
                nodeType={categoryToItemType[category]}
                category={category}
              />
            ))
          )}
        </>
      )}
    </Box>
  )
}

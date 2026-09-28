import { useEffect } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { QGISProjectNode } from './QGISProjectNode'
import { treeIndent, TREE_PLACEHOLDER_PL } from '../utils'

export function QGISProjectsRootNode() {
  const nodeId = 'qgisprojects-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  // Fetch QGIS projects
  const { data: qgisProjects, isLoading } = useQuery({
    queryKey: ['qgisprojects'],
    queryFn: () => api.getQGISProjects(),
    staleTime: 30000,
  })

  // Auto-expand QGIS Projects section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'QGIS Projects',
    type: 'qgisprojects',
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('qgisproject', { mode: 'create', data: {} })
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
        count={qgisProjects?.length}
      />
      {isExpanded && (
        <>
          {!qgisProjects || qgisProjects.length === 0 ? (
            <Box px={2} pl={TREE_PLACEHOLDER_PL} py={1.5} ml={treeIndent(2)}>
              <Text color="gray.500" fontSize="sm">
                No QGIS projects. Click + to add one.
              </Text>
            </Box>
          ) : (
            qgisProjects.map((project) => (
              <QGISProjectNode
                key={project.id}
                project={project}
              />
            ))
          )}
        </>
      )}
    </Box>
  )
}

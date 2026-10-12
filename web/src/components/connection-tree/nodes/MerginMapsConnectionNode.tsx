import { Box, Text } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode, MerginMapsConnection } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import { MerginMapsProjectNode } from './MerginMapsProjectNode'
import { TREE_PLACEHOLDER_PL } from '../utils'
import { TreeChildren } from '../TreeChildren'

interface MerginMapsConnectionNodeProps {
  connection: MerginMapsConnection
}

export function MerginMapsConnectionNode({ connection }: MerginMapsConnectionNodeProps) {
  const nodeId = generateNodeId('merginmapsconnection', connection.id)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const queryClient = useQueryClient()

  // Fetch projects when expanded
  const { data: projectsData, isLoading } = useQuery({
    queryKey: ['merginmapsprojects', connection.id],
    queryFn: () => api.getMerginMapsProjects(connection.id),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: connection.name,
    type: 'merginmapsconnection',
    merginMapsConnectionId: connection.id,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('merginmaps', {
      mode: 'edit',
      data: { connectionId: connection.id },
    })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete Mergin Maps Connection',
      message: `Are you sure you want to delete "${connection.name}"?`,
      data: { merginMapsConnectionId: connection.id },
    })
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['merginmapsprojects', connection.id] })
  }

  const projects = projectsData?.projects ?? []

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onRefresh={handleRefresh}
        level={2}
        count={projects.length}
      />
      {isExpanded && (
        <TreeChildren>
          {projects.length === 0 ? (
            <Box px={2} pl={TREE_PLACEHOLDER_PL} py={1.5}>
              <Text fontSize="xs" color="gray.400">
                No projects found.
              </Text>
            </Box>
          ) : (
            projects.map((project) => (
              <MerginMapsProjectNode
                key={`${project.namespace}/${project.name}`}
                connectionId={connection.id}
                project={project}
              />
            ))
          )}
        </TreeChildren>
      )}
    </Box>
  )
}

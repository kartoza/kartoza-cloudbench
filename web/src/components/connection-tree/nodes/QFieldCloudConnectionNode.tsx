import { Box, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode, QFieldCloudConnection, QFieldCloudProject } from '../../../types'
import * as api from '../../../api/client'
import { TreeNodeRow } from '../TreeNodeRow'
import { TREE_PLACEHOLDER_PL } from '../utils'
import { TreeChildren } from '../TreeChildren'

interface QFieldCloudConnectionNodeProps {
  connection: QFieldCloudConnection
}

export function QFieldCloudConnectionNode({ connection }: QFieldCloudConnectionNodeProps) {
  const nodeId = `qfcconn-${connection.id}`
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: projects, isLoading } = useQuery({
    queryKey: ['qfcprojects', connection.id],
    queryFn: () => api.listQFieldCloudProjects(connection.id),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: connection.name,
    type: 'qfieldcloudconnection',
    qfieldcloudConnectionId: connection.id,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('qfieldcloud', { mode: 'edit', data: connection as unknown as Record<string, unknown> })
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onEdit={handleEdit}
        level={2}
        count={projects?.length}
      />
      {isExpanded && (
        <TreeChildren>
          <QFieldCloudProjectsNode
            connectionId={connection.id}
            projects={projects || []}
            isLoading={isLoading}
          />
        </TreeChildren>
      )}
    </Box>
  )
}

// ─── Projects category node ───────────────────────────────────────────────────

interface QFieldCloudProjectsNodeProps {
  connectionId: string
  projects: QFieldCloudProject[]
  isLoading: boolean
}

function QFieldCloudProjectsNode({ connectionId, projects, isLoading }: QFieldCloudProjectsNodeProps) {
  const nodeId = `qfcprojects-${connectionId}`
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const node: TreeNode = {
    id: nodeId,
    name: 'Projects',
    type: 'qfieldcloudprojects',
    qfieldcloudConnectionId: connectionId,
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
        count={projects.length}
      />
      {isExpanded && (
        <TreeChildren>
          {projects.length === 0 && !isLoading && (
            <Box px={2} pl={TREE_PLACEHOLDER_PL} py={1.5}>
              <Text color="gray.500" fontSize="sm">No projects found.</Text>
            </Box>
          )}
          {projects.map((project) => (
            <QFieldCloudProjectNode
              key={project.id}
              connectionId={connectionId}
              project={project}
            />
          ))}
        </TreeChildren>
      )}
    </Box>
  )
}

// ─── Single project node ──────────────────────────────────────────────────────

interface QFieldCloudProjectNodeProps {
  connectionId: string
  project: QFieldCloudProject
}

function QFieldCloudProjectNode({ connectionId, project }: QFieldCloudProjectNodeProps) {
  const nodeId = `qfcproject-${project.id}`
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const node: TreeNode = {
    id: nodeId,
    name: project.name,
    type: 'qfieldcloudproject',
    qfieldcloudConnectionId: connectionId,
    qfieldcloudProjectId: project.id,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const subCategories: Array<{ id: string; name: string; type: TreeNode['type'] }> = [
    { id: `qfcfiles-${project.id}`, name: 'Files', type: 'qfieldcloudfiles' },
    { id: `qfcjobs-${project.id}`, name: 'Jobs', type: 'qfieldcloudjobs' },
    { id: `qfccollabs-${project.id}`, name: 'Collaborators', type: 'qfieldcloudcollaborators' },
    { id: `qfcdeltas-${project.id}`, name: 'Deltas', type: 'qfieldclouddeltas' },
  ]

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        level={4}
      />
      {isExpanded && (
        <TreeChildren>
          {subCategories.map((cat) => (
            <QFieldCloudSubCategoryNode
              key={cat.id}
              nodeId={cat.id}
              name={cat.name}
              type={cat.type}
              connectionId={connectionId}
              projectId={project.id}
            />
          ))}
        </TreeChildren>
      )}
    </Box>
  )
}

// ─── Sub-category nodes (Files, Jobs, etc.) ───────────────────────────────────

interface QFieldCloudSubCategoryNodeProps {
  nodeId: string
  name: string
  type: TreeNode['type']
  connectionId: string
  projectId: string
}

function QFieldCloudSubCategoryNode({ nodeId, name, type, connectionId, projectId }: QFieldCloudSubCategoryNodeProps) {
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const node: TreeNode = {
    id: nodeId,
    name,
    type,
    qfieldcloudConnectionId: connectionId,
    qfieldcloudProjectId: projectId,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
  }

  return (
    <TreeNodeRow
      node={node}
      isExpanded={false}
      isSelected={isSelected}
      isLoading={false}
      onClick={handleClick}
      level={5}
    />
  )
}

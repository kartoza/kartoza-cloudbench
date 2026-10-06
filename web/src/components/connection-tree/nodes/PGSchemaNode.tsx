import { Box } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import { TreeChildren } from '../TreeChildren'
import { PGTableNode } from './PGTableNode'
import type { PGSchemaNodeProps } from '../types'

export function PGSchemaNode({ serviceName, schema }: PGSchemaNodeProps) {
  const nodeId = generateNodeId('pgschema', serviceName, schema.name)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const queryClient = useQueryClient()

  const node: TreeNode = {
    id: nodeId,
    name: schema.name,
    type: 'pgschema',
    serviceName,
    schemaName: schema.name,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('pgupload', {
      mode: 'create',
      data: { serviceName, schemaName: schema.name },
    })
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['pgschemas', serviceName] })
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        onUpload={handleUpload}
        onRefresh={handleRefresh}
        level={3}
        count={schema.tables.length}
      />
      {isExpanded && (
        <TreeChildren>
          {schema.tables.map((table) => (
            <PGTableNode
              key={table.name}
              serviceName={serviceName}
              schemaName={schema.name}
              table={table}
            />
          ))}
        </TreeChildren>
      )}
    </Box>
  )
}

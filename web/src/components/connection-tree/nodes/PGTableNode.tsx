import { Box } from '@chakra-ui/react'
import { useTreeStore, generateNodeId } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import { TreeChildren } from '../TreeChildren'
import { PGColumnRow } from './PGColumnRow'
import type { PGTableNodeProps } from '../types'

export function PGTableNode({ serviceName, schemaName, table }: PGTableNodeProps) {
  const nodeType = table.is_view ? 'pgview' : 'pgtable'
  const nodeId = generateNodeId(nodeType, serviceName, schemaName, table.name)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setPGQuery = useUIStore((state) => state.setPGQuery)

  const node: TreeNode = {
    id: nodeId,
    name: table.name,
    type: nodeType,
    serviceName,
    schemaName,
    tableName: table.name,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleShowData = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('dataviewer', {
      mode: 'view',
      data: {
        serviceName,
        schemaName,
        tableName: table.name,
        isView: table.is_view,
      },
    })
  }

  const handleQuery = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPGQuery({
      serviceName,
      schemaName,
      tableName: table.name,
      initialSQL: `SELECT * FROM "${schemaName}"."${table.name}" LIMIT 100`,
    })
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        level={4}
        count={table.columns.length}
        onShowData={handleShowData}
        onQuery={handleQuery}
      />
      {isExpanded && (
        <TreeChildren>
          {table.columns.map((col) => (
            <PGColumnRow
              key={col.name}
              serviceName={serviceName}
              schemaName={schemaName}
              tableName={table.name}
              column={col}
            />
          ))}
        </TreeChildren>
      )}
    </Box>
  )
}

import { Box } from '@chakra-ui/react'
import { getApiBase } from '../../../config/env'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { generateNodeId, useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { TreeNode } from '../../../types'
import { TreeNodeRow } from '../TreeNodeRow'
import { PGSchemaNode } from './PGSchemaNode'
import type { PGServiceNodeProps } from '../types'
import { useOnlineStatus } from "../../../hooks/useOnlineStatus.ts";

export function PGServiceNode({ service, ableToEdit = true, ableToDelete = true }: PGServiceNodeProps) {
  const nodeId = generateNodeId('pgservice', service.name)
  const isOnline = useOnlineStatus(`${getApiBase()}/pg/services/${encodeURIComponent(service.name)}/test`)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setPGQuery = useUIStore((state) => state.setPGQuery)
  const queryClient = useQueryClient()

  const { data: schemaData, isLoading: loadingSchemas } = useQuery({
    queryKey: ['pgschemas', service.name],
    queryFn: async () => {
      const response = await fetch(`${getApiBase()}/pg/services/${encodeURIComponent(service.name)}/schemas`)
      if (!response.ok) throw new Error('Failed to fetch schemas')
      return response.json() as Promise<{
        schemas: {
          name: string;
          tables: {
            name: string;
            schema: string;
            columns: { name: string; type: string; nullable: boolean }[]
          }[]
        }[]
      }>
    },
    enabled: isExpanded,
    staleTime: 60000,
  })

  const node: TreeNode = {
    id: nodeId,
    name: service.name,
    type: 'pgservice',
    serviceName: service.name,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete PostgreSQL Service',
      message: `Are you sure you want to remove "${service.name}" from pg_service.conf?`,
      data: { pgServiceName: service.name },
    })
  }

  const handleQuery = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPGQuery({
      serviceName: service.name,
    })
  }

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('pgupload', {
      mode: 'create',
      data: { serviceName: service.name },
    })
  }

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    queryClient.invalidateQueries({ queryKey: ['pgschemas', service.name] })
  }

  return (
    <Box>
      <TreeNodeRow
        node={{ ...node, name: service.name }}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={loadingSchemas}
        onClick={handleClick}
        onDelete={handleDelete}
        onQuery={handleQuery}
        onUpload={handleUpload}
        onRefresh={handleRefresh}
        level={2}
        count={schemaData?.schemas?.length}
        isOnline={isOnline}
        ableToEdit={ableToEdit}
        ableToDelete={ableToDelete}
      />
      {isExpanded && schemaData?.schemas && schemaData.schemas.map((schema) => (
        <PGSchemaNode
          key={schema.name}
          serviceName={service.name}
          schema={schema}
        />
      ))}
    </Box>
  )
}
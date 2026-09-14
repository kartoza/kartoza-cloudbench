import { Box, Text } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { GeoNodeRemoteService, TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'

interface GeoNodeRemoteServicesNodeProps {
  connectionId: string
  services: GeoNodeRemoteService[]
  isLoading: boolean
}

export function GeoNodeRemoteServicesNode({
  connectionId,
  services,
  isLoading,
}: GeoNodeRemoteServicesNodeProps) {
  const nodeId = `geonode-remoteservices-${connectionId}`
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const queryClient = useQueryClient()

  const node: TreeNode = {
    id: nodeId,
    name: 'Remote Services',
    type: 'geonoderemoteservices',
    geonodeConnectionId: connectionId,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('geonodeaddremoteservice', {
      mode: 'create',
      data: { connectionId: connectionId },
    })
  }

  const handleDelete = (service: GeoNodeRemoteService) => (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete Remote Service',
      message: `Are you sure you want to delete remote service "${service.name}"?`,
      data: {},
      onConfirm: async () => {
        await api.deleteGeoNodeRemoteService(connectionId, service.id)
        queryClient.invalidateQueries({
          queryKey: ['geonoderemoteservices', connectionId],
        })
      },
    })
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
        level={3}
        count={services.length}
      />
      {isExpanded && (
        <>
          {services.length === 0 ? (
            <Box px={2} py={2} ml={4 * 4}>
              <Text color="gray.500" fontSize="sm">
                No remote services found
              </Text>
            </Box>
          ) : (
            services.map((service) => {
              const itemNodeId = `${service.id}`
              const itemNode: TreeNode = {
                id: itemNodeId,
                name: service.name,
                type: 'geonoderemoteservice',
                geonodeConnectionId: connectionId,
              }
              const isItemSelected = selectedNode?.id === itemNodeId

              return (
                <Box key={service.id}>
                  <TreeNodeRow
                    node={itemNode}
                    isExpanded={false}
                    isSelected={isItemSelected}
                    isLoading={false}
                    onClick={() => selectNode(itemNode)}
                    onDelete={handleDelete(service)}
                    level={4}
                  />
                </Box>
              )
            })
          )}
        </>
      )}
    </Box>
  )
}
import { Box } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useTreeStore } from '../../../stores/treeStore'
import { useUIStore } from '../../../stores/uiStore'
import type { GeoNodeConnection, TreeNode } from '../../../types'
import * as api from '../../../api'
import { TreeNodeRow } from '../TreeNodeRow'
import { GeoNodeResourceCategoryNode } from './GeoNodeResourceCategoryNode'
import { GeoNodeRemoteServicesNode } from './GeoNodeRemoteServicesNode'
import { API_BASE } from "../../../api";
import { useOnlineStatus } from "../../../hooks/useOnlineStatus.ts";

interface GeoNodeConnectionNodeProps {
  connection: GeoNodeConnection
}

export function GeoNodeConnectionNode({ connection }: GeoNodeConnectionNodeProps) {
  const nodeId = `geonodeconn-${connection.id}`
  const isOnline = useOnlineStatus(`${API_BASE}/geonode/connections/${connection.id}/test`)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  // Prefetch resources when expanded
  const { data: datasetsData, isLoading: datasetsLoading } = useQuery({
    queryKey: ['geonodedatasets', connection.id],
    queryFn: () => api.getGeoNodeDatasets(connection.id, 1, 100),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const { data: mapsData, isLoading: mapsLoading } = useQuery({
    queryKey: ['geonodemaps', connection.id],
    queryFn: () => api.getGeoNodeMaps(connection.id, 1, 100),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const { data: documentsData, isLoading: documentsLoading } = useQuery({
    queryKey: ['geonodedocuments', connection.id],
    queryFn: () => api.getGeoNodeDocuments(connection.id, 1, 100),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const { data: geostoriesData, isLoading: geostoriesLoading } = useQuery({
    queryKey: ['geonodegeostories', connection.id],
    queryFn: () => api.getGeoNodeGeoStories(connection.id, 1, 100),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const { data: dashboardsData, isLoading: dashboardsLoading } = useQuery({
    queryKey: ['geonodedashboards', connection.id],
    queryFn: () => api.getGeoNodeDashboards(connection.id, 1, 100),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const { data: remoteServicesData, isLoading: remoteServicesLoading } = useQuery({
    queryKey: ['geonoderemoteservices', connection.id],
    queryFn: () => api.getGeoNodeRemoteServices(connection.id),
    enabled: isExpanded,
    staleTime: 30000,
  })

  const isLoading =
    datasetsLoading ||
    mapsLoading ||
    documentsLoading ||
    geostoriesLoading ||
    dashboardsLoading ||
    remoteServicesLoading

  const node: TreeNode = {
    id: nodeId,
    name: connection.name,
    type: 'geonodeconnection',
    geonodeConnectionId: connection.id,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    if (isOnline === false) return
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('geonodeupload', {
      mode: 'create',
      data: {
        connectionId: connection.id,
        connectionName: connection.name
      },
    })
  }

  const handleOpenAdmin = (e: React.MouseEvent) => {
    e.stopPropagation()
    // GeoServer admin URL is typically the base URL + /web
    const adminUrl = connection.url
    window.open(adminUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        isOnline={isOnline}
        onOpenAdmin={handleOpenAdmin}
        onUpload={handleUpload}
        level={2}
      />
      {isExpanded && (
        <>
          {/* Datasets */}
          <GeoNodeResourceCategoryNode
            connectionId={connection.id}
            connectionUrl={connection.url}
            category="datasets"
            name="Datasets"
            resources={datasetsData?.datasets || []}
            total={datasetsData?.total || 0}
            isLoading={datasetsLoading}
          />

          {/* Maps */}
          <GeoNodeResourceCategoryNode
            connectionId={connection.id}
            connectionUrl={connection.url}
            category="maps"
            name="Maps"
            resources={mapsData?.maps || []}
            total={mapsData?.total || 0}
            isLoading={mapsLoading}
          />

          {/* Documents */}
          <GeoNodeResourceCategoryNode
            connectionId={connection.id}
            connectionUrl={connection.url}
            category="documents"
            name="Documents"
            resources={documentsData?.documents || []}
            total={documentsData?.total || 0}
            isLoading={documentsLoading}
          />

          {/* GeoStories */}
          <GeoNodeResourceCategoryNode
            connectionId={connection.id}
            connectionUrl={connection.url}
            category="geostories"
            name="GeoStories"
            resources={geostoriesData?.geostories || []}
            total={geostoriesData?.total || 0}
            isLoading={geostoriesLoading}
          />

          {/* Dashboards */}
          <GeoNodeResourceCategoryNode
            connectionId={connection.id}
            connectionUrl={connection.url}
            category="dashboards"
            name="Dashboards"
            resources={dashboardsData?.dashboards || []}
            total={dashboardsData?.total || 0}
            isLoading={dashboardsLoading}
          />

          {/* Remote Services */}
          <GeoNodeRemoteServicesNode
            connectionId={connection.id}
            services={remoteServicesData?.services || []}
            isLoading={remoteServicesLoading}
          />
        </>
      )}
    </Box>
  )
}

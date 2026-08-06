import { Box } from '@chakra-ui/react'
import { useEffect, useRef } from 'react'
import { useTreeStore } from '../stores/treeStore'
import { useUIStore } from '../stores/uiStore'
import * as api from '../api'
import MapPreview from './MapPreview'
import Globe3DPreview from './Globe3DPreview'
import S3LayerPreview from './S3LayerPreview'
import QGISMapPreview from './QGISMapPreview'
import GeoNodeMapPreview from './GeoNodeMapPreview'
import DuckDBQueryPanel from './DuckDBQueryPanel'
import IcebergTablePreview from './IcebergTablePreview'
import JupyterPanel from './JupyterPanel'
import { QueryPanel } from './QueryPanel'
import Dashboard from './Dashboard'
import {
  ConnectionPanel,
  WorkspacePanel,
  StorePanel,
  LayerPanel,
  LayerGroupPanel,
  StylePanel,
  PGServicePanel,
  PGSchemaPanel,
  PGTablePanel,
  S3ConnectionPanel,
  S3StoragePanel,
  GeoNodeResourcePanel,
  QFieldCloudPanel,
  MerginMapsProjectPanel,
  GeoNodeRemoteServicesPanel,
  GeoNodeRemoteServicesDetailPanel
} from './panels'
import {
  DataStoresDashboard,
  CoverageStoresDashboard,
  LayersDashboard,
  StylesDashboard,
  LayerGroupsDashboard,
} from './dashboards'

export default function MainContent() {
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const activePreview = useUIStore((state) => state.activePreview)
  const activeS3Preview = useUIStore((state) => state.activeS3Preview)
  const activeQGISPreview = useUIStore((state) => state.activeQGISPreview)
  const activeGeoNodePreview = useUIStore((state) => state.activeGeoNodePreview)
  const activeDuckDBQuery = useUIStore((state) => state.activeDuckDBQuery)
  const activePGQuery = useUIStore((state) => state.activePGQuery)
  const activeIcebergPreview = useUIStore((state) => state.activeIcebergPreview)
  const activeJupyterPreview = useUIStore((state) => state.activeJupyterPreview)
  const previewMode = useUIStore((state) => state.previewMode)
  const setPreview = useUIStore((state) => state.setPreview)
  const setS3Preview = useUIStore((state) => state.setS3Preview)
  const setQGISPreview = useUIStore((state) => state.setQGISPreview)
  const setGeoNodePreview = useUIStore((state) => state.setGeoNodePreview)
  const setDuckDBQuery = useUIStore((state) => state.setDuckDBQuery)
  const setPGQuery = useUIStore((state) => state.setPGQuery)
  const setIcebergPreview = useUIStore((state) => state.setIcebergPreview)
  const setJupyterPreview = useUIStore((state) => state.setJupyterPreview)
  const prevSelectedNodeRef = useRef(selectedNode)

  // Auto-update preview when selection changes to a previewable entity
  useEffect(() => {
    const prevNode = prevSelectedNodeRef.current
    prevSelectedNodeRef.current = selectedNode

    // Only auto-update if preview is currently active
    if (!activePreview || !selectedNode) return

    // Skip if the selection hasn't actually changed
    if (prevNode?.id === selectedNode.id) return

    // Check if the newly selected node is previewable
    const previewableTypes = ['layer', 'layergroup', 'datastore', 'coveragestore']
    if (!previewableTypes.includes(selectedNode.type)) return

    // Auto-start preview for the newly selected node
    const startAutoPreview = async () => {
      try {
        const layerType =
          selectedNode.type === 'coveragestore' ? 'raster' :
          selectedNode.type === 'layergroup' ? 'group' : 'vector'

        const { url } = await api.startPreview({
          connId: selectedNode.connectionId!,
          workspace: selectedNode.workspace!,
          layerName: selectedNode.name,
          storeName: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.name : undefined,
          storeType: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.type : undefined,
          layerType,
        })
        setPreview({
          url,
          layerName: selectedNode.name,
          workspace: selectedNode.workspace!,
          connectionId: selectedNode.connectionId!,
          storeName: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.name : undefined,
          storeType: selectedNode.type === 'datastore' || selectedNode.type === 'coveragestore'
            ? selectedNode.type : undefined,
          layerType,
        })
      } catch (err) {
        useUIStore.getState().setError((err as Error).message)
      }
    }

    startAutoPreview()
  }, [selectedNode, activePreview, setPreview])

  // Show PostgreSQL query panel if active
  if (activePGQuery) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        <QueryPanel
          key={`pg-${activePGQuery.serviceName}:${activePGQuery.schemaName || 'public'}:${activePGQuery.tableName || ''}`}
          serviceName={activePGQuery.serviceName}
          initialSchema={activePGQuery.schemaName}
          initialTable={activePGQuery.tableName}
          initialSQL={activePGQuery.initialSQL}
          onClose={() => setPGQuery(null)}
        />
      </Box>
    )
  }

  // Show Jupyter panel if active
  if (activeJupyterPreview) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        <JupyterPanel
          key={`jupyter-${activeJupyterPreview.connectionId}`}
          connectionId={activeJupyterPreview.connectionId}
          connectionName={activeJupyterPreview.connectionName}
          jupyterUrl={activeJupyterPreview.jupyterUrl}
          namespace={activeJupyterPreview.namespace}
          tableName={activeJupyterPreview.tableName}
          onClose={() => setJupyterPreview(null)}
        />
      </Box>
    )
  }

  // Show Iceberg table preview if active
  if (activeIcebergPreview) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        <IcebergTablePreview
          key={`iceberg-${activeIcebergPreview.connectionId}:${activeIcebergPreview.namespace}:${activeIcebergPreview.tableName}`}
          connectionId={activeIcebergPreview.connectionId}
          connectionName={activeIcebergPreview.connectionName}
          namespace={activeIcebergPreview.namespace}
          tableName={activeIcebergPreview.tableName}
          onClose={() => setIcebergPreview(null)}
        />
      </Box>
    )
  }

  // Show DuckDB query panel if active
  if (activeDuckDBQuery) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        <DuckDBQueryPanel
          key={`duckdb-${activeDuckDBQuery.connectionId}:${activeDuckDBQuery.bucketName}:${activeDuckDBQuery.objectKey}`}
          connectionId={activeDuckDBQuery.connectionId}
          bucketName={activeDuckDBQuery.bucketName}
          objectKey={activeDuckDBQuery.objectKey}
          displayName={activeDuckDBQuery.displayName}
          onClose={() => setDuckDBQuery(null)}
        />
      </Box>
    )
  }

  // Show QGIS preview if active
  if (activeQGISPreview) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        <QGISMapPreview
          key={`qgis-${activeQGISPreview.projectId}`}
          projectId={activeQGISPreview.projectId}
          projectName={activeQGISPreview.projectName}
          onClose={() => setQGISPreview(null)}
        />
      </Box>
    )
  }

  // Show GeoNode preview if active
  // Key only uses connectionId so the map persists when switching layers
  if (activeGeoNodePreview) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        <GeoNodeMapPreview
          key={`geonode-${activeGeoNodePreview.connectionId}`}
          geonodeUrl={activeGeoNodePreview.geonodeUrl}
          layerName={activeGeoNodePreview.layerName}
          title={activeGeoNodePreview.title}
          connectionId={activeGeoNodePreview.connectionId}
          detailUrl={activeGeoNodePreview.detailUrl}
          onClose={() => setGeoNodePreview(null)}
        />
      </Box>
    )
  }

  // Show S3 preview if active
  if (activeS3Preview) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        <S3LayerPreview
          key={`s3-${activeS3Preview.connectionId}:${activeS3Preview.bucketName}:${activeS3Preview.objectKey}`}
          connectionId={activeS3Preview.connectionId}
          bucketName={activeS3Preview.bucketName}
          objectKey={activeS3Preview.objectKey}
          onClose={() => setS3Preview(null)}
        />
      </Box>
    )
  }

  // Show GeoServer preview if active - fills the entire available space
  // Using key prop to force remount when layer changes, ensuring iframe and metadata fully refresh
  if (activePreview) {
    return (
      <Box flex="1" display="flex" flexDirection="column" minH="0">
        {previewMode === '3d' ? (
          <Globe3DPreview
            key={`3d-${activePreview.workspace}:${activePreview.layerName}`}
            connectionId={activePreview.connectionId}
            workspace={activePreview.workspace}
            layerName={activePreview.layerName}
            nodeType={activePreview.nodeType || (activePreview.layerType === 'group' ? 'layergroup' : 'layer')}
            onClose={() => setPreview(null)}
          />
        ) : (
          <MapPreview
            key={`2d-${activePreview.workspace}:${activePreview.layerName}:${activePreview.url}`}
            previewUrl={activePreview.url}
            layerName={activePreview.layerName}
            workspace={activePreview.workspace}
            connectionId={activePreview.connectionId}
            storeName={activePreview.storeName}
            storeType={activePreview.storeType}
            layerType={activePreview.layerType}
            onClose={() => setPreview(null)}
          />
        )}
      </Box>
    )
  }

  if (!selectedNode) {
    return <Dashboard />
  }

  switch (selectedNode.type) {
    case 'connection':
      return <ConnectionPanel connectionId={selectedNode.connectionId!} />
    case 'workspace':
      return (
        <WorkspacePanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'datastores':
      return (
        <DataStoresDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'coveragestores':
      return (
        <CoverageStoresDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'layers':
      return (
        <LayersDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'styles':
      return (
        <StylesDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'layergroups':
      return (
        <LayerGroupsDashboard
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
        />
      )
    case 'datastore':
    case 'coveragestore':
      return (
        <StorePanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          storeName={selectedNode.name}
          storeType={selectedNode.type}
        />
      )
    case 'layer':
      return (
        <LayerPanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          layerName={selectedNode.name}
        />
      )
    case 'style':
      return (
        <StylePanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          styleName={selectedNode.name}
        />
      )
    case 'layergroup':
      return (
        <LayerGroupPanel
          connectionId={selectedNode.connectionId!}
          workspace={selectedNode.workspace!}
          groupName={selectedNode.name}
        />
      )
    case 'pgservice':
      return (
        <PGServicePanel serviceName={selectedNode.serviceName!} />
      )
    case 'pgschema':
      return (
        <PGSchemaPanel
          serviceName={selectedNode.serviceName!}
          schemaName={selectedNode.schemaName!}
        />
      )
    case 'pgtable':
    case 'pgview':
      return (
        <PGTablePanel
          serviceName={selectedNode.serviceName!}
          schemaName={selectedNode.schemaName!}
          tableName={selectedNode.tableName!}
          isView={selectedNode.type === 'pgview'}
        />
      )
    case 's3connection':
      return (
        <S3ConnectionPanel connectionId={selectedNode.s3ConnectionId!} />
      )
    case 's3storage':
      return <S3StoragePanel />
    case 'geonodedataset':
    case 'geonodemap':
    case 'geonodedocument':
    case 'geonodegeostory':
    case 'geonodedashboard':
      return <GeoNodeResourcePanel node={selectedNode} />
    case 'qfieldcloud':
    case 'qfieldcloudconnection':
    case 'qfieldcloudprojects':
    case 'qfieldcloudproject':
    case 'qfieldcloudfiles':
    case 'qfieldcloudjobs':
    case 'qfieldcloudcollaborators':
    case 'qfieldclouddeltas':
      return <QFieldCloudPanel node={selectedNode} />
    case 'merginmapsproject':
      return <MerginMapsProjectPanel node={selectedNode} />
    case 'geonoderemoteservices':
      return <GeoNodeRemoteServicesPanel geonodeConnectionId={selectedNode.geonodeConnectionId || ''} />
    case 'geonoderemoteservice':
      return <GeoNodeRemoteServicesDetailPanel geonodeConnectionId={selectedNode.geonodeConnectionId || ''} serviceId={selectedNode.id} name={selectedNode.name} />
    default:
      return <Dashboard />
  }
}

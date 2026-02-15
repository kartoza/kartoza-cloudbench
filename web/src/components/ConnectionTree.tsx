import { useEffect, useState } from 'react'
import {
  Box,
  Flex,
  Text,
  Spinner,
  IconButton,
  Icon,
  Tooltip,
  Badge,
  useColorModeValue,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Checkbox,
  Button,
  useToast,
} from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FiChevronRight,
  FiChevronDown,
  FiEdit2,
  FiTrash2,
  FiEye,
  FiDownload,
  FiServer,
  FiFolder,
  FiDatabase,
  FiImage,
  FiLayers,
  FiDroplet,
  FiGrid,
  FiFileText,
  FiMap,
  FiPlus,
  FiUpload,
  FiExternalLink,
  FiGlobe,
  FiCloud,
  FiTable,
  FiColumns,
  FiCode,
  FiRefreshCw,
} from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import { useConnectionStore } from '../stores/connectionStore'
import { useTreeStore, generateNodeId } from '../stores/treeStore'
import { useUIStore } from '../stores/uiStore'
import * as api from '../api/client'
import type { TreeNode, NodeType } from '../types'

// Get the icon component for each node type
function getNodeIconComponent(type: NodeType | 'featuretype' | 'coverage') {
  switch (type) {
    case 'cloudbench':
      return FiCloud
    case 'geoserver':
      return FiGlobe
    case 'postgresql':
      return SiPostgresql
    case 'connection':
      return FiServer
    case 'pgservice':
      return FiDatabase
    case 'pgschema':
      return FiFolder
    case 'pgtable':
      return FiTable
    case 'pgview':
      return FiEye
    case 'pgcolumn':
      return FiColumns
    case 'workspace':
      return FiFolder
    case 'datastores':
    case 'datastore':
      return FiDatabase
    case 'coveragestores':
    case 'coveragestore':
      return FiImage
    case 'layers':
    case 'layer':
      return FiLayers
    case 'styles':
    case 'style':
      return FiDroplet
    case 'layergroups':
    case 'layergroup':
      return FiGrid
    case 'featuretype':
      return FiFileText
    case 'coverage':
      return FiMap
    default:
      return FiFolder
  }
}

// Get color for each node type
function getNodeColor(type: NodeType | 'featuretype' | 'coverage'): string {
  switch (type) {
    case 'cloudbench':
      return 'kartoza.500'
    case 'geoserver':
      return 'blue.500'
    case 'postgresql':
      return 'blue.600'
    case 'connection':
      return 'kartoza.500'
    case 'pgservice':
      return 'blue.500'
    case 'pgschema':
      return 'cyan.500'
    case 'pgtable':
      return 'green.500'
    case 'pgview':
      return 'purple.500'
    case 'pgcolumn':
      return 'gray.500'
    case 'workspace':
      return 'accent.400'
    case 'datastores':
    case 'datastore':
      return 'green.500'
    case 'coveragestores':
    case 'coveragestore':
      return 'purple.500'
    case 'layers':
    case 'layer':
      return 'blue.500'
    case 'styles':
    case 'style':
      return 'pink.500'
    case 'layergroups':
    case 'layergroup':
      return 'cyan.500'
    case 'featuretype':
      return 'teal.500'
    case 'coverage':
      return 'orange.500'
    default:
      return 'gray.500'
  }
}

export default function ConnectionTree() {
  const connections = useConnectionStore((state) => state.connections)
  const fetchConnections = useConnectionStore((state) => state.fetchConnections)

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

  return (
    <Box>
      {/* CloudBench Root Node */}
      <CloudBenchRootNode connections={connections} />
    </Box>
  )
}

// CloudBench root node - top level container
function CloudBenchRootNode({ connections }: { connections: { id: string; name: string; url: string }[] }) {
  const nodeId = 'cloudbench-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  // Auto-expand root on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'Kartoza CloudBench',
    type: 'cloudbench',
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
        isLoading={false}
        onClick={handleClick}
        level={0}
      />
      {isExpanded && (
        <Box pl={4}>
          {/* GeoServer Section */}
          <GeoServerRootNode connections={connections} />
          {/* PostgreSQL Section */}
          <PostgreSQLRootNode />
        </Box>
      )}
    </Box>
  )
}

// GeoServer root node - container for all GeoServer connections
function GeoServerRootNode({ connections }: { connections: { id: string; name: string; url: string }[] }) {
  const nodeId = 'geoserver-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  // Auto-expand GeoServer section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'GeoServer',
    type: 'geoserver',
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
        isLoading={false}
        onClick={handleClick}
        level={1}
        count={connections.length}
      />
      {isExpanded && (
        <Box pl={4}>
          {connections.length === 0 ? (
            <Box px={2} py={3}>
              <Text color="gray.500" fontSize="sm">
                No connections yet. Click + to add one.
              </Text>
            </Box>
          ) : (
            connections.map((conn) => (
              <ConnectionNode
                key={conn.id}
                connectionId={conn.id}
                name={conn.name}
                url={conn.url}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

// PostgreSQL root node - container for PostgreSQL services
function PostgreSQLRootNode() {
  const nodeId = 'postgresql-root'
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const showHiddenPGServices = useUIStore((state) => state.settings.showHiddenPGServices)

  // Fetch PostgreSQL services
  const { data: pgServices, isLoading } = useQuery({
    queryKey: ['pgservices'],
    queryFn: () => api.getPGServices(),
    staleTime: 30000,
  })

  // Filter hidden services based on setting
  const filteredPGServices = pgServices?.filter(
    (service) => showHiddenPGServices || !service.hidden
  )

  // Auto-expand PostgreSQL section on mount
  useEffect(() => {
    if (!isExpanded) {
      toggleNode(nodeId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const node: TreeNode = {
    id: nodeId,
    name: 'PostgreSQL',
    type: 'postgresql',
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
        level={1}
        count={filteredPGServices?.length}
      />
      {isExpanded && (
        <Box pl={4}>
          {!filteredPGServices || filteredPGServices.length === 0 ? (
            <Box px={2} py={3}>
              <Text color="gray.500" fontSize="sm">
                No PostgreSQL services. Click + to add one.
              </Text>
            </Box>
          ) : (
            filteredPGServices.map((svc) => (
              <PGServiceNode
                key={svc.name}
                service={svc}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

// PostgreSQL service node - individual pg_service.conf entry
interface PGServiceNodeProps {
  service: api.PGService
}

function PGServiceNode({ service }: PGServiceNodeProps) {
  const nodeId = generateNodeId('pgservice', service.name)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const toast = useToast()
  const queryClient = useQueryClient()

  // Fetch schemas when expanded and service is parsed
  const { data: schemaData, isLoading: loadingSchemas } = useQuery({
    queryKey: ['pgschemas', service.name],
    queryFn: async () => {
      const response = await fetch(`/api/pg/services/${encodeURIComponent(service.name)}/schemas`)
      if (!response.ok) throw new Error('Failed to fetch schemas')
      return response.json() as Promise<{ schemas: { name: string; tables: { name: string; schema: string; columns: { name: string; type: string; nullable: boolean }[] }[] }[] }>
    },
    enabled: isExpanded && service.is_parsed,
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

  const handleParse = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.parsePGService(service.name)
      toast({
        title: 'Schema Parsed',
        description: `Successfully parsed schema for ${service.name}`,
        status: 'success',
        duration: 3000,
      })
      queryClient.invalidateQueries({ queryKey: ['pgservices'] })
      queryClient.invalidateQueries({ queryKey: ['pgschemas', service.name] })
    } catch (err) {
      toast({
        title: 'Parse Failed',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    }
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
    openDialog('query', {
      mode: 'view',
      data: { serviceName: service.name },
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
    // Re-parse the service to refresh schema data
    queryClient.invalidateQueries({ queryKey: ['pgschemas', service.name] })
  }

  const subtitle = service.host ? `${service.host}:${service.port || '5432'}/${service.dbname || ''}` : ''

  return (
    <Box>
      <TreeNodeRow
        node={{ ...node, name: service.name }}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={loadingSchemas}
        onClick={handleClick}
        onDelete={handleDelete}
        onQuery={service.is_parsed ? handleQuery : undefined}
        onUpload={handleUpload}
        onRefresh={service.is_parsed ? handleRefresh : undefined}
        level={2}
        count={schemaData?.schemas?.length}
      />
      {/* Show parse button or schemas */}
      {isExpanded && !service.is_parsed && (
        <Box pl={8} py={2}>
          <Button
            size="sm"
            colorScheme="blue"
            variant="outline"
            leftIcon={<FiDatabase size={14} />}
            onClick={handleParse}
          >
            Parse Schema
          </Button>
          <Text fontSize="xs" color="gray.500" mt={1}>
            {subtitle}
          </Text>
        </Box>
      )}
      {isExpanded && service.is_parsed && schemaData?.schemas && (
        <Box pl={4}>
          {schemaData.schemas.map((schema) => (
            <PGSchemaNode
              key={schema.name}
              serviceName={service.name}
              schema={schema}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

// PostgreSQL schema node
interface PGSchemaNodeProps {
  serviceName: string
  schema: {
    name: string
    tables: { name: string; schema: string; columns: { name: string; type: string; nullable: boolean }[] }[]
  }
}

function PGSchemaNode({ serviceName, schema }: PGSchemaNodeProps) {
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
    // Refresh schemas for the parent service
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
        <Box pl={4}>
          {schema.tables.map((table) => (
            <PGTableNode
              key={table.name}
              serviceName={serviceName}
              schemaName={schema.name}
              table={table}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

// PostgreSQL table node
interface PGTableNodeProps {
  serviceName: string
  schemaName: string
  table: {
    name: string
    is_view?: boolean
    columns: { name: string; type: string; nullable: boolean }[]
  }
}

function PGTableNode({ serviceName, schemaName, table }: PGTableNodeProps) {
  const nodeType = table.is_view ? 'pgview' : 'pgtable'
  const nodeId = generateNodeId(nodeType, serviceName, schemaName, table.name)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

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
    openDialog('query', {
      mode: 'view',
      data: {
        serviceName,
        schemaName,
        tableName: table.name,
        initialSQL: `SELECT * FROM "${schemaName}"."${table.name}" LIMIT 100`,
      },
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
        <Box pl={4}>
          {table.columns.map((col) => (
            <PGColumnRow
              key={col.name}
              serviceName={serviceName}
              schemaName={schemaName}
              tableName={table.name}
              column={col}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

// PostgreSQL column row (leaf node)
interface PGColumnRowProps {
  serviceName: string
  schemaName: string
  tableName: string
  column: { name: string; type: string; nullable: boolean }
}

function PGColumnRow({ serviceName, schemaName, tableName, column }: PGColumnRowProps) {
  const nodeId = generateNodeId('pgcolumn', serviceName, schemaName, `${tableName}:${column.name}`)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const node: TreeNode = {
    id: nodeId,
    name: `${column.name} (${column.type}${column.nullable ? ', nullable' : ''})`,
    type: 'pgcolumn',
    serviceName,
    schemaName,
    tableName,
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
      isLeaf
    />
  )
}

interface ConnectionNodeProps {
  connectionId: string
  name: string
  url: string
}

function ConnectionNode({ connectionId, name, url }: ConnectionNodeProps) {
  const nodeId = generateNodeId('connection', connectionId)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces', connectionId],
    queryFn: () => api.getWorkspaces(connectionId),
    staleTime: 30000, // Cache for 30 seconds
  })

  const node: TreeNode = {
    id: nodeId,
    name,
    type: 'connection',
    connectionId,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('connection', { mode: 'edit', data: { connectionId } })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete Connection',
      message: `Are you sure you want to delete connection "${name}"?`,
      data: { connectionId },
    })
  }

  const handleOpenAdmin = (e: React.MouseEvent) => {
    e.stopPropagation()
    // GeoServer admin URL is typically the base URL + /web
    const adminUrl = url.replace(/\/rest\/?$/, '/web')
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
        onEdit={handleEdit}
        onDelete={handleDelete}
        onOpenAdmin={handleOpenAdmin}
        level={2}
        count={workspaces?.length}
      />
      {isExpanded && workspaces && (
        <Box pl={4}>
          {workspaces.map((ws) => (
            <WorkspaceNode
              key={ws.name}
              connectionId={connectionId}
              workspace={ws.name}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

interface WorkspaceNodeProps {
  connectionId: string
  workspace: string
}

function WorkspaceNode({ connectionId, workspace }: WorkspaceNodeProps) {
  const nodeId = generateNodeId('workspace', connectionId, workspace)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const node: TreeNode = {
    id: nodeId,
    name: workspace,
    type: 'workspace',
    connectionId,
    workspace,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('workspace', { mode: 'edit', data: { connectionId, workspace } })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: 'Delete Workspace',
      message: `Are you sure you want to delete workspace "${workspace}"?`,
      data: { connectionId, workspace },
    })
  }

  const handleDownloadConfig = (e: React.MouseEvent) => {
    e.stopPropagation()
    api.downloadResource(connectionId, 'workspace', workspace)
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        onEdit={handleEdit}
        onDownloadConfig={handleDownloadConfig}
        onDelete={handleDelete}
        level={3}
      />
      {isExpanded && (
        <Box pl={4}>
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="datastores"
            label="Data Stores"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="coveragestores"
            label="Coverage Stores"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="layers"
            label="Layers"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="styles"
            label="Styles"
          />
          <CategoryNode
            connectionId={connectionId}
            workspace={workspace}
            category="layergroups"
            label="Layer Groups"
          />
        </Box>
      )}
    </Box>
  )
}

interface CategoryNodeProps {
  connectionId: string
  workspace: string
  category: 'datastores' | 'coveragestores' | 'layers' | 'styles' | 'layergroups'
  label: string
}

function CategoryNode({ connectionId, workspace, category, label }: CategoryNodeProps) {
  const nodeId = generateNodeId(category, connectionId, workspace)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const { data: items, isLoading } = useQuery({
    queryKey: [category, connectionId, workspace],
    queryFn: async (): Promise<{ name: string }[]> => {
      switch (category) {
        case 'datastores':
          return api.getDataStores(connectionId, workspace)
        case 'coveragestores':
          return api.getCoverageStores(connectionId, workspace)
        case 'layers':
          return api.getLayers(connectionId, workspace)
        case 'styles':
          return api.getStyles(connectionId, workspace)
        case 'layergroups':
          return api.getLayerGroups(connectionId, workspace)
      }
    },
    staleTime: 30000, // Cache for 30 seconds
  })

  const node: TreeNode = {
    id: nodeId,
    name: label,
    type: category,
    connectionId,
    workspace,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
    toggleNode(nodeId)
  }

  const getChildType = (): NodeType => {
    switch (category) {
      case 'datastores':
        return 'datastore'
      case 'coveragestores':
        return 'coveragestore'
      case 'layers':
        return 'layer'
      case 'styles':
        return 'style'
      case 'layergroups':
        return 'layergroup'
    }
  }

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        level={4}
        count={items?.length}
      />
      {isExpanded && items && (
        <Box pl={4}>
          {items.map((item) => (
            <ItemNode
              key={item.name}
              connectionId={connectionId}
              workspace={workspace}
              name={item.name}
              type={getChildType()}
              storeType={category === 'coveragestores' ? 'coveragestore' : category === 'datastores' ? 'datastore' : undefined}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

interface ItemNodeProps {
  connectionId: string
  workspace: string
  name: string
  type: NodeType
  storeType?: string
}

function ItemNode({ connectionId, workspace, name, type, storeType }: ItemNodeProps) {
  const nodeId = generateNodeId(type, connectionId, workspace, name)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setPreview = useUIStore((state) => state.setPreview)
  const setPreviewMode = useUIStore((state) => state.setPreviewMode)

  // For datastores and coveragestores, we can expand to show feature types / coverages
  const isExpandable = type === 'datastore' || type === 'coveragestore'

  // Fetch feature types for datastores
  const { data: featureTypes, isLoading: loadingFeatureTypes, error: featureTypesError } = useQuery({
    queryKey: ['featuretypes', connectionId, workspace, name],
    queryFn: () => api.getFeatureTypes(connectionId, workspace, name),
    enabled: isExpandable && type === 'datastore' && isExpanded,
    staleTime: 30000,
  })

  // Fetch coverages for coveragestores
  const { data: coverages, isLoading: loadingCoverages, error: coveragesError } = useQuery({
    queryKey: ['coverages', connectionId, workspace, name],
    queryFn: () => api.getCoverages(connectionId, workspace, name),
    enabled: isExpandable && type === 'coveragestore' && isExpanded,
    staleTime: 30000,
  })

  // Fetch available (unpublished) feature types for datastores
  const { data: availableFeatureTypes, error: availableError } = useQuery({
    queryKey: ['available-featuretypes', connectionId, workspace, name],
    queryFn: () => api.getAvailableFeatureTypes(connectionId, workspace, name),
    enabled: isExpandable && type === 'datastore' && isExpanded,
    staleTime: 30000,
  })

  // Fetch feature count for layers when selected (to minimize API calls)
  // The API returns -1 for layers that can't be counted (e.g., raster layers)
  const isSelected = selectedNode?.id === nodeId
  const { data: featureCount } = useQuery({
    queryKey: ['feature-count', connectionId, workspace, name],
    queryFn: () => api.getLayerFeatureCount(connectionId, workspace, name),
    enabled: type === 'layer' && isSelected,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: false, // Don't retry on failure (e.g., for raster layers)
  })

  // Log errors for debugging
  if (featureTypesError) console.error('Feature types error:', featureTypesError)
  if (coveragesError) console.error('Coverages error:', coveragesError)
  if (availableError) console.error('Available feature types error:', availableError)

  const node: TreeNode = {
    id: nodeId,
    name,
    type,
    connectionId,
    workspace,
    storeName: type === 'layer' ? undefined : name,
    storeType,
  }

  const isLoading = loadingFeatureTypes || loadingCoverages

  const handleClick = () => {
    selectNode(node)
    if (isExpandable) {
      toggleNode(nodeId)
    }
  }

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    const layerType = storeType === 'coveragestore' ? 'raster' : 'vector'
    api.startPreview({
      connId: connectionId,
      workspace,
      layerName: name,
      storeName: name,
      storeType,
      layerType,
    }).then(({ url }) => {
      // Use inline preview instead of opening new tab
      setPreview({
        url,
        layerName: name,
        workspace,
        connectionId,
        storeName: name,
        storeType,
        layerType,
      })
    }).catch((err) => {
      useUIStore.getState().setError(err.message)
    })
  }

  const handleTerria = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Set preview mode to 3D and open embedded preview
    const layerType = storeType === 'coveragestore' ? 'raster' : 'vector'
    setPreviewMode('3d')
    setPreview({
      url: '', // Globe3DPreview doesn't need a preview URL, it fetches from Terria API
      layerName: name,
      workspace,
      connectionId,
      storeName: name,
      storeType,
      layerType,
      nodeType: type, // 'layer' or 'layergroup'
    })
  }

  const handleEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (type === 'style') {
      openDialog('style', {
        mode: 'edit',
        data: { connectionId, workspace, name },
      })
    } else if (type === 'layer') {
      openDialog('layer', {
        mode: 'edit',
        data: { connectionId, workspace, layerName: name, storeType },
      })
    } else if (type === 'layergroup') {
      // Fetch layer group details for edit mode
      try {
        const details = await api.getLayerGroup(connectionId, workspace, name)
        // Extract layer names without workspace prefix
        const layerNames = details.layers?.map((l) => {
          const parts = l.name.split(':')
          return parts.length > 1 ? parts[1] : l.name
        }) || []
        openDialog('layergroup', {
          mode: 'edit',
          data: {
            connectionId,
            workspace,
            name: details.name,
            title: details.title || '',
            mode: details.mode,
            layers: layerNames,
          },
        })
      } catch (err) {
        useUIStore.getState().setError((err as Error).message)
      }
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('confirm', {
      mode: 'delete',
      title: `Delete ${type}`,
      message: `Are you sure you want to delete "${name}"?`,
      data: { connectionId, workspace, name, type },
    })
  }

  const handleDownloadConfig = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Map NodeType to DownloadResourceType
    const resourceTypeMap: Record<string, api.DownloadResourceType> = {
      datastore: 'datastore',
      coveragestore: 'coveragestore',
      layer: 'layer',
      style: 'style',
      layergroup: 'layergroup',
    }
    const resourceType = resourceTypeMap[type]
    if (resourceType) {
      api.downloadResource(connectionId, resourceType, workspace, name)
    }
  }

  const handleDownloadData = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (type === 'layer' || storeType === 'datastore') {
      // Vector layer - download as shapefile
      api.downloadShapefile(connectionId, workspace, name)
    } else if (storeType === 'coveragestore') {
      // Raster coverage - download as GeoTIFF
      api.downloadGeoTiff(connectionId, workspace, name)
    }
  }

  // Determine if download is available for this node type
  const canDownloadConfig = ['datastore', 'coveragestore', 'layer', 'style', 'layergroup'].includes(type)
  // Data download is only for layers (vector=shapefile, raster=geotiff)
  const canDownloadData = type === 'layer'
  const downloadDataLabel = storeType === 'coveragestore' ? 'GeoTIFF' : 'Shapefile'
  // Edit is available for styles, layers, and layer groups
  const canEdit = type === 'style' || type === 'layer' || type === 'layergroup'

  // Combine published and available feature types count
  const totalCount = type === 'datastore'
    ? (featureTypes?.length || 0) + (availableFeatureTypes?.length || 0)
    : type === 'coveragestore'
    ? coverages?.length
    : type === 'layer' && featureCount !== undefined && featureCount >= 0
    ? featureCount
    : undefined

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={isLoading}
        onClick={handleClick}
        onEdit={canEdit ? handleEdit : undefined}
        onPreview={type === 'layer' || type === 'datastore' || type === 'coveragestore' ? handlePreview : undefined}
        onTerria={type === 'layer' || type === 'layergroup' ? handleTerria : undefined}
        onDownloadConfig={canDownloadConfig ? handleDownloadConfig : undefined}
        onDownloadData={canDownloadData ? handleDownloadData : undefined}
        downloadDataLabel={downloadDataLabel}
        onDelete={handleDelete}
        level={5}
        isLeaf={!isExpandable}
        count={totalCount}
      />
      {isExpanded && type === 'datastore' && (
        <Box pl={4}>
          {featureTypesError ? (
            <Text fontSize="xs" color="red.500" px={2} py={2}>
              Error loading datasets: {(featureTypesError as Error).message}
            </Text>
          ) : (
            <DataStoreContentsNode
              connectionId={connectionId}
              workspace={workspace}
              storeName={name}
              featureTypes={featureTypes || []}
              availableFeatureTypes={availableFeatureTypes || []}
            />
          )}
        </Box>
      )}
      {isExpanded && type === 'coveragestore' && (
        <Box pl={4}>
          {coveragesError ? (
            <Text fontSize="xs" color="red.500" px={2} py={2}>
              Error loading coverages: {(coveragesError as Error).message}
            </Text>
          ) : (
            <CoverageStoreContentsNode
              connectionId={connectionId}
              workspace={workspace}
              storeName={name}
              coverages={coverages || []}
            />
          )}
        </Box>
      )}
    </Box>
  )
}

// Component to show datastore contents with publish functionality
interface DataStoreContentsNodeProps {
  connectionId: string
  workspace: string
  storeName: string
  featureTypes: { name: string }[]
  availableFeatureTypes: string[]
}

function DataStoreContentsNode({
  connectionId,
  workspace,
  storeName,
  featureTypes,
  availableFeatureTypes,
}: DataStoreContentsNodeProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [selectedForPublish, setSelectedForPublish] = useState<Set<string>>(new Set())
  const [isPublishing, setIsPublishing] = useState(false)
  const setPreview = useUIStore((state) => state.setPreview)

  const toggleSelection = (name: string) => {
    const newSelection = new Set(selectedForPublish)
    if (newSelection.has(name)) {
      newSelection.delete(name)
    } else {
      newSelection.add(name)
    }
    setSelectedForPublish(newSelection)
  }

  const selectAll = () => {
    setSelectedForPublish(new Set(availableFeatureTypes))
  }

  const handlePublishSelected = async () => {
    if (selectedForPublish.size === 0) return

    setIsPublishing(true)
    try {
      const result = await api.publishFeatureTypes(
        connectionId,
        workspace,
        storeName,
        Array.from(selectedForPublish)
      )

      if (result.published.length > 0) {
        toast({
          title: 'Layers Published',
          description: `Successfully published ${result.published.length} layer(s)`,
          status: 'success',
          duration: 3000,
        })
        // Refresh queries
        queryClient.invalidateQueries({ queryKey: ['featuretypes', connectionId, workspace, storeName] })
        queryClient.invalidateQueries({ queryKey: ['available-featuretypes', connectionId, workspace, storeName] })
        queryClient.invalidateQueries({ queryKey: ['layers', connectionId, workspace] })
        setSelectedForPublish(new Set())
      }

      if (result.errors.length > 0) {
        toast({
          title: 'Some layers failed to publish',
          description: result.errors.join(', '),
          status: 'warning',
          duration: 5000,
        })
      }
    } catch (error) {
      toast({
        title: 'Failed to publish layers',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsPublishing(false)
    }
  }

  const handlePublishSingle = async (featureTypeName: string) => {
    try {
      await api.publishFeatureType(connectionId, workspace, storeName, featureTypeName)
      toast({
        title: 'Layer Published',
        description: `Successfully published ${featureTypeName}`,
        status: 'success',
        duration: 3000,
      })
      // Refresh queries
      queryClient.invalidateQueries({ queryKey: ['featuretypes', connectionId, workspace, storeName] })
      queryClient.invalidateQueries({ queryKey: ['available-featuretypes', connectionId, workspace, storeName] })
      queryClient.invalidateQueries({ queryKey: ['layers', connectionId, workspace] })
    } catch (error) {
      toast({
        title: 'Failed to publish layer',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    }
  }

  const handlePreviewPublished = (featureTypeName: string) => {
    api.startPreview({
      connId: connectionId,
      workspace,
      layerName: featureTypeName,
      storeName,
      storeType: 'datastore',
      layerType: 'vector',
    }).then(({ url }) => {
      setPreview({
        url,
        layerName: featureTypeName,
        workspace,
        connectionId,
        storeName,
        storeType: 'datastore',
        layerType: 'vector',
      })
    }).catch((err) => {
      toast({
        title: 'Preview failed',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    })
  }

  const bgAvailable = useColorModeValue('yellow.50', 'yellow.900')
  const bgPublished = useColorModeValue('green.50', 'green.900')

  return (
    <Box>
      {/* Published feature types */}
      {featureTypes.length > 0 && (
        <Box mb={2}>
          <Text fontSize="xs" fontWeight="600" color="gray.500" px={2} py={1}>
            Published ({featureTypes.length})
          </Text>
          {featureTypes.map((ft) => (
            <DatasetRow
              key={ft.name}
              name={ft.name}
              isPublished
              bg={bgPublished}
              onPreview={() => handlePreviewPublished(ft.name)}
            />
          ))}
        </Box>
      )}

      {/* Unpublished feature types */}
      {availableFeatureTypes.length > 0 && (
        <Box>
          <Flex align="center" justify="space-between" px={2} py={1}>
            <Text fontSize="xs" fontWeight="600" color="gray.500">
              Available to Publish ({availableFeatureTypes.length})
            </Text>
            <Flex gap={1}>
              <Button
                size="xs"
                variant="ghost"
                onClick={selectAll}
                isDisabled={selectedForPublish.size === availableFeatureTypes.length}
              >
                Select All
              </Button>
              {selectedForPublish.size > 0 && (
                <Button
                  size="xs"
                  colorScheme="kartoza"
                  leftIcon={<FiUpload size={12} />}
                  onClick={handlePublishSelected}
                  isLoading={isPublishing}
                >
                  Publish ({selectedForPublish.size})
                </Button>
              )}
            </Flex>
          </Flex>
          {availableFeatureTypes.map((ftName) => (
            <DatasetRow
              key={ftName}
              name={ftName}
              isPublished={false}
              bg={bgAvailable}
              isSelected={selectedForPublish.has(ftName)}
              onToggleSelect={() => toggleSelection(ftName)}
              onPublish={() => handlePublishSingle(ftName)}
            />
          ))}
        </Box>
      )}

      {featureTypes.length === 0 && availableFeatureTypes.length === 0 && (
        <Text fontSize="xs" color="gray.500" px={2} py={2} fontStyle="italic">
          No datasets in this store
        </Text>
      )}
    </Box>
  )
}

// Component to show coveragestore contents
interface CoverageStoreContentsNodeProps {
  connectionId: string
  workspace: string
  storeName: string
  coverages: { name: string }[]
}

function CoverageStoreContentsNode({
  connectionId,
  workspace,
  storeName,
  coverages,
}: CoverageStoreContentsNodeProps) {
  const setPreview = useUIStore((state) => state.setPreview)
  const toast = useToast()

  const handlePreview = (coverageName: string) => {
    api.startPreview({
      connId: connectionId,
      workspace,
      layerName: coverageName,
      storeName,
      storeType: 'coveragestore',
      layerType: 'raster',
    }).then(({ url }) => {
      setPreview({
        url,
        layerName: coverageName,
        workspace,
        connectionId,
        storeName,
        storeType: 'coveragestore',
        layerType: 'raster',
      })
    }).catch((err) => {
      toast({
        title: 'Preview failed',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    })
  }

  const bgPublished = useColorModeValue('purple.50', 'purple.900')

  return (
    <Box>
      {coverages.length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight="600" color="gray.500" px={2} py={1}>
            Coverages ({coverages.length})
          </Text>
          {coverages.map((cov) => (
            <DatasetRow
              key={cov.name}
              name={cov.name}
              isPublished
              isCoverage
              bg={bgPublished}
              onPreview={() => handlePreview(cov.name)}
            />
          ))}
        </Box>
      )}

      {coverages.length === 0 && (
        <Text fontSize="xs" color="gray.500" px={2} py={2} fontStyle="italic">
          No coverages in this store
        </Text>
      )}
    </Box>
  )
}

// Reusable row component for datasets (feature types and coverages)
interface DatasetRowProps {
  name: string
  isPublished: boolean
  isCoverage?: boolean
  bg: string
  isSelected?: boolean
  onToggleSelect?: () => void
  onPublish?: () => void
  onPreview?: () => void
}

function DatasetRow({
  name,
  isPublished,
  isCoverage = false,
  bg,
  isSelected,
  onToggleSelect,
  onPublish,
  onPreview,
}: DatasetRowProps) {
  const hoverBg = useColorModeValue('gray.100', 'gray.600')
  const iconType = isCoverage ? 'coverage' : 'featuretype'
  const NodeIcon = getNodeIconComponent(iconType)
  const nodeColor = getNodeColor(iconType)

  return (
    <Flex
      align="center"
      py={1.5}
      px={2}
      pl={6}
      bg={bg}
      _hover={{ bg: hoverBg }}
      borderRadius="md"
      mx={1}
      my={0.5}
      role="group"
    >
      {!isPublished && onToggleSelect && (
        <Checkbox
          size="sm"
          isChecked={isSelected}
          onChange={onToggleSelect}
          mr={2}
          colorScheme="kartoza"
        />
      )}
      <Box
        p={1}
        borderRadius="md"
        mr={2}
      >
        <Icon
          as={NodeIcon}
          boxSize={3.5}
          color={nodeColor}
        />
      </Box>
      <Text
        flex="1"
        fontSize="sm"
        noOfLines={1}
      >
        {name}
      </Text>
      {isPublished && (
        <Badge colorScheme="green" fontSize="2xs" mr={2}>
          Published
        </Badge>
      )}
      <Flex
        gap={1}
        opacity={0}
        _groupHover={{ opacity: 1 }}
        transition="opacity 0.15s"
      >
        {onPreview && (
          <Tooltip label="Preview" fontSize="xs">
            <IconButton
              aria-label="Preview"
              icon={<FiEye size={12} />}
              size="xs"
              variant="ghost"
              colorScheme="kartoza"
              onClick={(e) => {
                e.stopPropagation()
                onPreview()
              }}
            />
          </Tooltip>
        )}
        {!isPublished && onPublish && (
          <Tooltip label="Publish as Layer" fontSize="xs">
            <IconButton
              aria-label="Publish"
              icon={<FiPlus size={12} />}
              size="xs"
              variant="ghost"
              colorScheme="green"
              onClick={(e) => {
                e.stopPropagation()
                onPublish()
              }}
            />
          </Tooltip>
        )}
      </Flex>
    </Flex>
  )
}

interface TreeNodeRowProps {
  node: TreeNode
  isExpanded: boolean
  isSelected: boolean
  isLoading: boolean
  onClick: () => void
  onEdit?: (e: React.MouseEvent) => void
  onDelete?: (e: React.MouseEvent) => void
  onPreview?: (e: React.MouseEvent) => void
  onTerria?: (e: React.MouseEvent) => void
  onOpenAdmin?: (e: React.MouseEvent) => void
  onQuery?: (e: React.MouseEvent) => void
  onShowData?: (e: React.MouseEvent) => void
  onUpload?: (e: React.MouseEvent) => void
  onRefresh?: (e: React.MouseEvent) => void
  onDownloadConfig?: (e: React.MouseEvent) => void
  onDownloadData?: (e: React.MouseEvent) => void
  downloadDataLabel?: string // "Shapefile" or "GeoTIFF"
  level: number
  isLeaf?: boolean
  count?: number
}

function TreeNodeRow({
  node,
  isExpanded,
  isSelected,
  isLoading,
  onClick,
  onEdit,
  onDelete,
  onPreview,
  onTerria,
  onOpenAdmin,
  onQuery,
  onShowData,
  onUpload,
  onRefresh,
  onDownloadConfig,
  onDownloadData,
  downloadDataLabel,
  level,
  isLeaf,
  count,
}: TreeNodeRowProps) {
  const bgColor = useColorModeValue(
    isSelected ? 'kartoza.50' : 'transparent',
    isSelected ? 'kartoza.900' : 'transparent'
  )
  const hoverBg = useColorModeValue('gray.50', 'gray.700')
  const textColor = useColorModeValue('gray.800', 'gray.100')
  const selectedTextColor = useColorModeValue('kartoza.700', 'kartoza.200')
  const borderColor = useColorModeValue('kartoza.500', 'kartoza.400')
  const chevronColor = useColorModeValue('gray.500', 'gray.400')
  const nodeColor = getNodeColor(node.type)
  const NodeIcon = getNodeIconComponent(node.type)

  return (
    <Flex
      align="center"
      py={2}
      px={2}
      pl={level * 4 + 2}
      cursor="pointer"
      bg={bgColor}
      borderLeft={isSelected ? '3px solid' : '3px solid transparent'}
      borderLeftColor={isSelected ? borderColor : 'transparent'}
      _hover={{
        bg: isSelected ? bgColor : hoverBg,
        '& .chevron-icon': { color: 'kartoza.500' },
      }}
      borderRadius="md"
      transition="all 0.15s ease"
      onClick={onClick}
      role="group"
      mx={1}
      my={0.5}
    >
      {!isLeaf && (
        <Box w={4} mr={2} color={chevronColor} className="chevron-icon" transition="color 0.15s">
          {isLoading ? (
            <Spinner size="xs" color="kartoza.500" />
          ) : isExpanded ? (
            <FiChevronDown size={14} />
          ) : (
            <FiChevronRight size={14} />
          )}
        </Box>
      )}
      {isLeaf && <Box w={4} mr={2} />}
      <Box
        p={1.5}
        borderRadius="md"
        bg={isSelected ? `${nodeColor.split('.')[0]}.100` : 'transparent'}
        mr={2}
        transition="background 0.15s"
        _groupHover={{ bg: `${nodeColor.split('.')[0]}.50` }}
      >
        <Icon
          as={NodeIcon}
          boxSize={4}
          color={nodeColor}
        />
      </Box>
      <Text
        flex="1"
        fontSize="sm"
        color={isSelected ? selectedTextColor : textColor}
        fontWeight={isSelected ? '600' : 'normal'}
        noOfLines={1}
        letterSpacing={isSelected ? '-0.01em' : 'normal'}
      >
        {node.name}
      </Text>
      {count !== undefined && count >= 0 && (
        <Badge
          colorScheme={nodeColor.split('.')[0]}
          variant="subtle"
          fontSize="xs"
          borderRadius="full"
          px={2}
          mr={2}
          fontWeight="600"
        >
          {count}
        </Badge>
      )}
      {/* Admin link - always visible for connections */}
      {onOpenAdmin && (
        <Tooltip label="Open GeoServer Admin" fontSize="xs">
          <IconButton
            aria-label="Open Admin"
            icon={<FiExternalLink size={14} />}
            size="xs"
            variant="ghost"
            colorScheme="blue"
            onClick={onOpenAdmin}
            _hover={{ bg: 'blue.50' }}
            mr={1}
          />
        </Tooltip>
      )}
      <Flex
        gap={1}
        opacity={0}
        _groupHover={{ opacity: 1 }}
        transition="opacity 0.15s"
      >
        {(onDownloadConfig || onDownloadData) && (
          <Menu isLazy placement="bottom-end">
            <Tooltip label="Download" fontSize="xs">
              <MenuButton
                as={IconButton}
                aria-label="Download"
                icon={<FiDownload size={14} />}
                size="xs"
                variant="ghost"
                colorScheme="kartoza"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                _hover={{ bg: 'kartoza.100' }}
              />
            </Tooltip>
            <MenuList minW="180px" fontSize="sm">
              {onDownloadConfig && (
                <MenuItem icon={<FiFileText />} onClick={onDownloadConfig}>
                  Download Config (JSON)
                </MenuItem>
              )}
              {onDownloadData && (
                <MenuItem icon={<FiMap />} onClick={onDownloadData}>
                  Download {downloadDataLabel || 'Data'}
                </MenuItem>
              )}
            </MenuList>
          </Menu>
        )}
        {onPreview && (
          <Tooltip label="Preview" fontSize="xs">
            <IconButton
              aria-label="Preview"
              icon={<FiEye size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="kartoza"
              onClick={onPreview}
              _hover={{ bg: 'kartoza.100' }}
            />
          </Tooltip>
        )}
        {onRefresh && (
          <Tooltip label="Refresh" fontSize="xs">
            <IconButton
              aria-label="Refresh"
              icon={<FiRefreshCw size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="cyan"
              onClick={onRefresh}
              _hover={{ bg: 'cyan.50' }}
            />
          </Tooltip>
        )}
        {onUpload && (
          <Tooltip label="Import Data" fontSize="xs">
            <IconButton
              aria-label="Import Data"
              icon={<FiUpload size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="green"
              onClick={onUpload}
              _hover={{ bg: 'green.50' }}
            />
          </Tooltip>
        )}
        {onShowData && (
          <Tooltip label="View Data" fontSize="xs">
            <IconButton
              aria-label="View Data"
              icon={<FiTable size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="blue"
              onClick={onShowData}
              _hover={{ bg: 'blue.50' }}
            />
          </Tooltip>
        )}
        {onQuery && (
          <Tooltip label="Query" fontSize="xs">
            <IconButton
              aria-label="Query"
              icon={<FiCode size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="purple"
              onClick={onQuery}
              _hover={{ bg: 'purple.50' }}
            />
          </Tooltip>
        )}
        {onTerria && (
          <Tooltip label="Open in Terria 3D" fontSize="xs">
            <IconButton
              aria-label="Open in Terria 3D"
              icon={<FiGlobe size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="teal"
              onClick={onTerria}
              _hover={{ bg: 'teal.50' }}
            />
          </Tooltip>
        )}
        {onEdit && (
          <Tooltip label="Edit" fontSize="xs">
            <IconButton
              aria-label="Edit"
              icon={<FiEdit2 size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="kartoza"
              onClick={onEdit}
              _hover={{ bg: 'kartoza.100' }}
            />
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip label="Delete" fontSize="xs">
            <IconButton
              aria-label="Delete"
              icon={<FiTrash2 size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="red"
              onClick={onDelete}
              _hover={{ bg: 'red.50' }}
            />
          </Tooltip>
        )}
      </Flex>
    </Flex>
  )
}

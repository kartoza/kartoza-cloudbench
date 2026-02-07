import { useEffect } from 'react'
import {
  Box,
  Flex,
  Text,
  Spinner,
  IconButton,
  Icon,
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import {
  FiChevronRight,
  FiChevronDown,
  FiEdit2,
  FiTrash2,
  FiEye,
  FiServer,
  FiFolder,
  FiDatabase,
  FiImage,
  FiLayers,
  FiDroplet,
  FiGrid,
} from 'react-icons/fi'
import { useConnectionStore } from '../stores/connectionStore'
import { useTreeStore, generateNodeId } from '../stores/treeStore'
import { useUIStore } from '../stores/uiStore'
import * as api from '../api/client'
import type { TreeNode, NodeType } from '../types'

// Get the icon component for each node type
function getNodeIconComponent(type: NodeType) {
  switch (type) {
    case 'connection':
      return FiServer
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
    default:
      return FiFolder
  }
}

// Get color for each node type
function getNodeColor(type: NodeType): string {
  switch (type) {
    case 'connection':
      return 'kartoza.500'
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

  if (connections.length === 0) {
    return (
      <Box p={6} textAlign="center">
        <Icon as={FiServer} boxSize={10} color="gray.300" mb={3} />
        <Text color="gray.500" fontSize="sm" fontWeight="500">
          No connections yet
        </Text>
        <Text color="gray.400" fontSize="xs" mt={1}>
          Click the + button above to add a GeoServer connection
        </Text>
      </Box>
    )
  }

  return (
    <Box>
      {connections.map((conn) => (
        <ConnectionNode
          key={conn.id}
          connectionId={conn.id}
          name={conn.name}
        />
      ))}
    </Box>
  )
}

interface ConnectionNodeProps {
  connectionId: string
  name: string
}

function ConnectionNode({ connectionId, name }: ConnectionNodeProps) {
  const nodeId = generateNodeId('connection', connectionId)
  const isExpanded = useTreeStore((state) => state.isExpanded(nodeId))
  const toggleNode = useTreeStore((state) => state.toggleNode)
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces', connectionId],
    queryFn: () => api.getWorkspaces(connectionId),
    enabled: isExpanded,
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
        level={0}
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

  return (
    <Box>
      <TreeNodeRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isLoading={false}
        onClick={handleClick}
        onEdit={handleEdit}
        onDelete={handleDelete}
        level={1}
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
    enabled: isExpanded,
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
        level={2}
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
  const selectNode = useTreeStore((state) => state.selectNode)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const openDialog = useUIStore((state) => state.openDialog)
  const setPreview = useUIStore((state) => state.setPreview)

  const node: TreeNode = {
    id: nodeId,
    name,
    type,
    connectionId,
    workspace,
    storeName: type === 'layer' ? undefined : name,
    storeType,
  }

  const isSelected = selectedNode?.id === nodeId

  const handleClick = () => {
    selectNode(node)
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
        storeName: name,
        storeType,
        layerType,
      })
    }).catch((err) => {
      useUIStore.getState().setError(err.message)
    })
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

  return (
    <TreeNodeRow
      node={node}
      isExpanded={false}
      isSelected={isSelected}
      isLoading={false}
      onClick={handleClick}
      onPreview={type === 'layer' || type === 'datastore' || type === 'coveragestore' ? handlePreview : undefined}
      onDelete={handleDelete}
      level={3}
      isLeaf
    />
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
  level: number
  isLeaf?: boolean
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
  level,
  isLeaf,
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
              icon={<FiEye size={14} />}
              size="xs"
              variant="ghost"
              colorScheme="kartoza"
              onClick={onPreview}
              _hover={{ bg: 'kartoza.100' }}
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

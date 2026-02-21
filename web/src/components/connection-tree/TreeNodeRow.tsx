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
} from '@chakra-ui/react'
import {
  FiChevronRight,
  FiChevronDown,
  FiEdit2,
  FiTrash2,
  FiEye,
  FiDownload,
  FiFileText,
  FiMap,
  FiUpload,
  FiExternalLink,
  FiGlobe,
  FiTable,
  FiCode,
  FiRefreshCw,
  FiPlus,
} from 'react-icons/fi'
import { getNodeIconComponent, getNodeColor } from './utils'
import type { TreeNodeRowProps } from './types'

export function TreeNodeRow({
  node,
  isExpanded,
  isSelected,
  isLoading,
  onClick,
  onAdd,
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
      {/* Add button - always visible for root nodes */}
      {onAdd && (
        <Tooltip label="Add" fontSize="xs">
          <IconButton
            aria-label="Add"
            icon={<FiPlus size={14} />}
            size="xs"
            variant="ghost"
            colorScheme="green"
            onClick={onAdd}
            _hover={{ bg: 'green.50' }}
            mr={1}
          />
        </Tooltip>
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

import {
  Box,
  Flex,
  Text,
  IconButton,
  Icon,
  Tooltip,
  Badge,
  useColorModeValue,
  Checkbox,
} from '@chakra-ui/react'
import {
  FiEye,
  FiPlus,
} from 'react-icons/fi'
import { getNodeIconComponent, getNodeColor, TREE_BORDER_PX, TREE_PLACEHOLDER_PL } from './utils'
import type { DatasetRowProps } from './types'

export function DatasetRow({
  name,
  isPublished,
  isCoverage = false,
  bg,
  isSelected,
  onToggleSelect,
  onPublish,
  onPreview,
}: DatasetRowProps) {
  const hoverBg = useColorModeValue('gray.100', 'whiteAlpha.100')
  const separatorColor = useColorModeValue('gray.100', 'whiteAlpha.100')
  const guideColor = useColorModeValue('gray.200', 'whiteAlpha.200')
  const iconType = isCoverage ? 'coverage' : 'featuretype'
  const NodeIcon = getNodeIconComponent(iconType)
  const nodeColor = getNodeColor(iconType)

  return (
    <Flex
      align="center"
      py={1}
      px={2}
      // Icon lines up with sibling rows' icons (past their chevron column).
      pl={TREE_PLACEHOLDER_PL}
      bg={bg}
      borderLeft={`${TREE_BORDER_PX}px solid`}
      borderLeftColor={guideColor}
      borderBottom="1px solid"
      borderBottomColor={separatorColor}
      _hover={{ bg: hoverBg }}
      mr={1}
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

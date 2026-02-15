import {
  Box,
  Flex,
  Heading,
  IconButton,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Tooltip,
  useColorModeValue,
  InputGroup,
  InputLeftElement,
  Input,
  Kbd,
  HStack,
} from '@chakra-ui/react'
import { FiPlus, FiSettings, FiUpload, FiRefreshCw, FiHelpCircle, FiRefreshCcw, FiSearch } from 'react-icons/fi'
import { useUIStore } from '../stores/uiStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useTreeStore } from '../stores/treeStore'

interface HeaderProps {
  onSearchClick?: () => void
}

export default function Header({ onSearchClick }: HeaderProps) {
  const bgColor = useColorModeValue('kartoza.700', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)
  const fetchConnections = useConnectionStore((state) => state.fetchConnections)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const handleNewConnection = () => {
    openDialog('connection', { mode: 'create' })
  }

  const handleUpload = () => {
    if (!selectedNode) {
      useUIStore.getState().setError('Select a workspace or PostgreSQL service first')
      return
    }

    const nodeType = selectedNode.type

    // PostgreSQL-related nodes → open PG upload dialog
    if (nodeType === 'postgresql' || nodeType === 'pgservice' || nodeType === 'pgschema' ||
        nodeType === 'pgtable' || nodeType === 'pgview' || nodeType === 'pgcolumn') {
      // Get service name and optionally schema name
      const serviceName = selectedNode.serviceName
      const schemaName = nodeType === 'pgschema' ? selectedNode.schemaName : undefined

      if (!serviceName) {
        useUIStore.getState().setError('Select a PostgreSQL service first')
        return
      }

      openDialog('pgupload', {
        mode: 'create',
        data: { serviceName, schemaName },
      })
      return
    }

    // GeoServer-related nodes → open GeoServer upload dialog
    if (!selectedNode.workspace) {
      useUIStore.getState().setError('Select a workspace first')
      return
    }
    openDialog('upload', { mode: 'create' })
  }

  const handleRefresh = () => {
    fetchConnections()
    useUIStore.getState().setStatus('Refreshing...')
  }

  return (
    <Box bg={bgColor} px={4} py={2}>
      <Flex align="center">
        <Heading size="md" color="white" fontWeight="bold">
          Kartoza GeoServer Client
        </Heading>

        {/* Search Bar */}
        <Box
          mx={8}
          flex="1"
          maxW="400px"
          onClick={onSearchClick}
          cursor="pointer"
        >
          <InputGroup size="sm">
            <InputLeftElement pointerEvents="none">
              <FiSearch color="gray.400" />
            </InputLeftElement>
            <Input
              placeholder="Search..."
              bg="whiteAlpha.100"
              border="1px solid"
              borderColor="whiteAlpha.200"
              color="white"
              _placeholder={{ color: 'whiteAlpha.500' }}
              _hover={{ borderColor: 'whiteAlpha.400', bg: 'whiteAlpha.200' }}
              borderRadius="md"
              readOnly
              cursor="pointer"
            />
            <HStack
              position="absolute"
              right={2}
              top="50%"
              transform="translateY(-50%)"
              spacing={1}
            >
              <Kbd size="xs" bg="whiteAlpha.200" color="whiteAlpha.700" borderColor="whiteAlpha.300">
                ⌘
              </Kbd>
              <Kbd size="xs" bg="whiteAlpha.200" color="whiteAlpha.700" borderColor="whiteAlpha.300">
                K
              </Kbd>
            </HStack>
          </InputGroup>
        </Box>

        <Spacer />
        <Flex gap={2}>
          <Tooltip label="Add Connection" placement="bottom">
            <IconButton
              aria-label="Add connection"
              icon={<FiPlus />}
              variant="ghost"
              color="white"
              _hover={{ bg: 'kartoza.600' }}
              onClick={handleNewConnection}
            />
          </Tooltip>
          <Tooltip
            label={
              selectedNode?.type === 'postgresql' || selectedNode?.type === 'pgservice' ||
              selectedNode?.type === 'pgschema' || selectedNode?.type === 'pgtable' ||
              selectedNode?.type === 'pgview' || selectedNode?.type === 'pgcolumn'
                ? 'Upload to PostgreSQL'
                : 'Upload to GeoServer'
            }
            placement="bottom"
          >
            <IconButton
              aria-label="Upload files"
              icon={<FiUpload />}
              variant="ghost"
              color="white"
              _hover={{ bg: 'kartoza.600' }}
              onClick={handleUpload}
            />
          </Tooltip>
          <Tooltip label="Refresh" placement="bottom">
            <IconButton
              aria-label="Refresh"
              icon={<FiRefreshCw />}
              variant="ghost"
              color="white"
              _hover={{ bg: 'kartoza.600' }}
              onClick={handleRefresh}
            />
          </Tooltip>
          <Menu>
            <MenuButton
              as={IconButton}
              aria-label="Settings"
              icon={<FiSettings />}
              variant="ghost"
              color="white"
              _hover={{ bg: 'kartoza.600' }}
            />
            <MenuList>
              <MenuItem
                icon={<FiRefreshCcw />}
                onClick={() => openDialog('sync', { mode: 'create' })}
              >
                Sync Server(s)
              </MenuItem>
              <MenuItem icon={<FiHelpCircle />}>Help</MenuItem>
              <MenuItem
                icon={<FiPlus />}
                onClick={() => openDialog('workspace', { mode: 'create' })}
              >
                New Workspace
              </MenuItem>
              <MenuItem
                icon={<FiPlus />}
                onClick={() => openDialog('datastore', { mode: 'create' })}
              >
                New Data Store
              </MenuItem>
              <MenuItem
                icon={<FiPlus />}
                onClick={() => openDialog('coveragestore', { mode: 'create' })}
              >
                New Coverage Store
              </MenuItem>
            </MenuList>
          </Menu>
        </Flex>
      </Flex>
    </Box>
  )
}

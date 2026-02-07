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
} from '@chakra-ui/react'
import { FiPlus, FiSettings, FiUpload, FiRefreshCw, FiHelpCircle } from 'react-icons/fi'
import { useUIStore } from '../stores/uiStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useTreeStore } from '../stores/treeStore'

export default function Header() {
  const bgColor = useColorModeValue('kartoza.700', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)
  const fetchConnections = useConnectionStore((state) => state.fetchConnections)
  const selectedNode = useTreeStore((state) => state.selectedNode)

  const handleNewConnection = () => {
    openDialog('connection', { mode: 'create' })
  }

  const handleUpload = () => {
    if (!selectedNode?.workspace) {
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
          <Tooltip label="Upload Files" placement="bottom">
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

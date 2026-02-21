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
  InputGroup,
  InputLeftElement,
  Input,
  Kbd,
  HStack,
  Link,
  Image,
  Text,
} from '@chakra-ui/react'
import { FiSettings, FiRefreshCw, FiHelpCircle, FiRefreshCcw, FiSearch, FiChevronDown, FiUpload } from 'react-icons/fi'
import { useUIStore } from '../stores/uiStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useTreeStore } from '../stores/treeStore'

interface HeaderProps {
  onSearchClick?: () => void
  onHelpClick?: () => void
}

export default function Header({ onSearchClick, onHelpClick }: HeaderProps) {
  const openDialog = useUIStore((state) => state.openDialog)
  const fetchConnections = useConnectionStore((state) => state.fetchConnections)
  const selectedNode = useTreeStore((state) => state.selectedNode)

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

  // Navigation items matching Kartoza website style
  const navItemStyle = {
    color: 'gray.700',
    fontWeight: '500',
    fontSize: 'sm',
    px: 3,
    py: 2,
    borderRadius: 'md',
    _hover: {
      color: 'kartoza.500',
      bg: 'gray.50',
    },
    transition: 'all 0.2s ease',
  }

  return (
    <Box>
      {/* Main Navigation - White background like Kartoza website */}
      <Box
        bg="white"
        px={6}
        py={3}
        borderBottom="1px solid"
        borderBottomColor="gray.100"
        boxShadow="0 2px 4px rgba(0, 0, 0, 0.04)"
      >
        <Flex align="center" maxW="1400px" mx="auto">
          {/* Logo */}
          <Link
            href="https://kartoza.com"
            isExternal
            display="flex"
            alignItems="center"
            _hover={{ opacity: 0.9 }}
            mr={8}
          >
            <Image
              src="/kartoza-logo.svg"
              alt="Kartoza"
              h="36px"
            />
          </Link>

          {/* App Name */}
          <Heading
            size="md"
            color="gray.800"
            fontWeight="600"
            mr={8}
          >
            Cloudbench
          </Heading>

          {/* Navigation Menu Items */}
          <HStack spacing={1} display={{ base: 'none', md: 'flex' }}>
            <Menu>
              <MenuButton
                as={Box}
                cursor="pointer"
                {...navItemStyle}
                display="flex"
                alignItems="center"
              >
                <HStack spacing={1}>
                  <Text>Tools</Text>
                  <FiChevronDown size={14} />
                </HStack>
              </MenuButton>
              <MenuList>
                <MenuItem
                  icon={<FiRefreshCcw />}
                  onClick={() => openDialog('sync', { mode: 'create' })}
                >
                  Sync GeoServer(s)
                </MenuItem>
                <MenuItem
                  icon={<FiUpload />}
                  onClick={handleUpload}
                >
                  Upload Data
                </MenuItem>
              </MenuList>
            </Menu>
          </HStack>

          <Spacer />

          {/* Search Bar */}
          <Box
            mx={4}
            w="280px"
            onClick={onSearchClick}
            cursor="pointer"
          >
            <InputGroup size="sm">
              <InputLeftElement pointerEvents="none">
                <FiSearch color="#9E9E9E" />
              </InputLeftElement>
              <Input
                placeholder="Search..."
                bg="gray.50"
                border="1px solid"
                borderColor="gray.200"
                color="gray.700"
                _placeholder={{ color: 'gray.400' }}
                _hover={{ borderColor: 'gray.300', bg: 'gray.100' }}
                _focus={{ borderColor: 'kartoza.500', bg: 'white' }}
                borderRadius="full"
                readOnly
                cursor="pointer"
              />
              <HStack
                position="absolute"
                right={3}
                top="50%"
                transform="translateY(-50%)"
                spacing={1}
              >
                <Kbd size="xs" bg="gray.100" color="gray.500" borderColor="gray.200" fontSize="10px">
                  ⌘K
                </Kbd>
              </HStack>
            </InputGroup>
          </Box>

          {/* Action Icons */}
          <HStack spacing={1}>
            <Tooltip label="Refresh" placement="bottom">
              <IconButton
                aria-label="Refresh"
                icon={<FiRefreshCw size={18} />}
                variant="ghost"
                color="gray.600"
                _hover={{ bg: 'gray.100', color: 'kartoza.500' }}
                onClick={handleRefresh}
                size="sm"
              />
            </Tooltip>
            <Tooltip label="Settings" placement="bottom">
              <IconButton
                aria-label="Settings"
                icon={<FiSettings size={18} />}
                variant="ghost"
                color="gray.600"
                _hover={{ bg: 'gray.100', color: 'kartoza.500' }}
                size="sm"
              />
            </Tooltip>
            <Tooltip label="Help (?)" placement="bottom">
              <IconButton
                aria-label="Help"
                icon={<FiHelpCircle size={18} />}
                variant="ghost"
                color="gray.600"
                _hover={{ bg: 'gray.100', color: 'kartoza.500' }}
                onClick={onHelpClick}
                size="sm"
              />
            </Tooltip>
          </HStack>
        </Flex>
      </Box>

      {/* News Ticker Bar - Teal colored like Kartoza website */}
      <Box
        bg="kartoza.700"
        py={2}
        px={6}
      >
        <Text
          color="white"
          fontSize="sm"
          textAlign="center"
          fontWeight="400"
        >
          Kartoza Cloudbench — Manage your GeoServer and PostgreSQL instances
        </Text>
      </Box>
    </Box>
  )
}

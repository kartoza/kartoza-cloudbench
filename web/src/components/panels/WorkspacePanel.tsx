import {
  VStack,
  Card,
  CardBody,
  Flex,
  HStack,
  Box,
  Icon,
  Heading,
  Spacer,
  Button,
  Badge,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Divider,
  useColorModeValue,
} from '@chakra-ui/react'
import { FiFolder, FiDatabase, FiImage, FiLayers, FiUpload, FiPlus, FiLink } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'

interface WorkspacePanelProps {
  connectionId: string
  workspace: string
}

export default function WorkspacePanel({
  connectionId,
  workspace,
}: WorkspacePanelProps) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: config } = useQuery({
    queryKey: ['workspace', connectionId, workspace],
    queryFn: () => api.getWorkspace(connectionId, workspace),
  })

  const { data: datastores } = useQuery({
    queryKey: ['datastores', connectionId, workspace],
    queryFn: () => api.getDataStores(connectionId, workspace),
  })

  const { data: coveragestores } = useQuery({
    queryKey: ['coveragestores', connectionId, workspace],
    queryFn: () => api.getCoverageStores(connectionId, workspace),
  })

  const { data: layers } = useQuery({
    queryKey: ['layers', connectionId, workspace],
    queryFn: () => api.getLayers(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      {/* Workspace Header */}
      <Card
        bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiFolder} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg" color="white">{workspace}</Heading>
                <HStack>
                  {config?.default && <Badge colorScheme="blue">Default</Badge>}
                  {config?.isolated && <Badge colorScheme="purple">Isolated</Badge>}
                  {config?.enabled && <Badge colorScheme="green">Enabled</Badge>}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <Button
              variant="outline"
              color="white"
              borderColor="whiteAlpha.400"
              _hover={{ bg: 'whiteAlpha.200' }}
              onClick={() => openDialog('workspace', { mode: 'edit', data: { connectionId, workspace } })}
            >
              Edit Workspace
            </Button>
          </Flex>
        </CardBody>
      </Card>

      {/* Stats Grid */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
        <Card bg={cardBg} variant="elevated" cursor="pointer">
          <CardBody>
            <Stat>
              <HStack>
                <Icon as={FiDatabase} color="kartoza.500" boxSize={6} />
                <StatLabel>Data Stores</StatLabel>
              </HStack>
              <StatNumber color="kartoza.700">{datastores?.length ?? 0}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card bg={cardBg} variant="elevated" cursor="pointer">
          <CardBody>
            <Stat>
              <HStack>
                <Icon as={FiImage} color="accent.400" boxSize={6} />
                <StatLabel>Coverage Stores</StatLabel>
              </HStack>
              <StatNumber color="kartoza.700">{coveragestores?.length ?? 0}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
        <Card bg={cardBg} variant="elevated" cursor="pointer">
          <CardBody>
            <Stat>
              <HStack>
                <Icon as={FiLayers} color="kartoza.500" boxSize={6} />
                <StatLabel>Layers</StatLabel>
              </HStack>
              <StatNumber color="kartoza.700">{layers?.length ?? 0}</StatNumber>
            </Stat>
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Quick Actions */}
      <Card bg={cardBg}>
        <CardBody>
          <VStack align="stretch" spacing={4}>
            <Heading size="sm" color="gray.600">Quick Actions</Heading>
            <Divider />
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
              <Button
                variant="accent"
                leftIcon={<FiUpload />}
                onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
              >
                Upload Data
              </Button>
              <Button
                variant="outline"
                leftIcon={<FiLink />}
                onClick={() => openDialog('pgconnect', { mode: 'create', data: { connectionId, workspace } })}
              >
                Connect to PostgreSQL
              </Button>
              <Button
                variant="outline"
                leftIcon={<FiPlus />}
                onClick={() => openDialog('datastore', { mode: 'create', data: { connectionId, workspace } })}
              >
                New Data Store
              </Button>
              <Button
                variant="outline"
                leftIcon={<FiPlus />}
                onClick={() => openDialog('coveragestore', { mode: 'create', data: { connectionId, workspace } })}
              >
                New Coverage Store
              </Button>
            </SimpleGrid>
          </VStack>
        </CardBody>
      </Card>

      {/* OGC Services */}
      {config && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="start" spacing={3}>
              <Heading size="sm" color="gray.600">OGC Services</Heading>
              <Divider />
              <HStack wrap="wrap" gap={2}>
                <Badge colorScheme={config.wmsEnabled ? 'green' : 'gray'} px={3} py={1}>WMS</Badge>
                <Badge colorScheme={config.wfsEnabled ? 'green' : 'gray'} px={3} py={1}>WFS</Badge>
                <Badge colorScheme={config.wcsEnabled ? 'green' : 'gray'} px={3} py={1}>WCS</Badge>
                <Badge colorScheme={config.wmtsEnabled ? 'green' : 'gray'} px={3} py={1}>WMTS</Badge>
                <Badge colorScheme={config.wpsEnabled ? 'green' : 'gray'} px={3} py={1}>WPS</Badge>
              </HStack>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

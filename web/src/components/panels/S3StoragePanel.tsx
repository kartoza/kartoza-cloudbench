import {
  VStack,
  Card,
  CardBody,
  HStack,
  Box,
  Icon,
  Heading,
  Text,
  Spacer,
  Button,
  Badge,
  SimpleGrid,
  Center,
  Spinner,
  Flex,
  useColorModeValue,
} from '@chakra-ui/react'
import {
  FiPlus,
  FiCheckCircle,
  FiAlertCircle,
  FiHardDrive,
  FiRefreshCw,
} from 'react-icons/fi'
import { SiAmazons3 } from 'react-icons/si'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../../api/client'
import { useUIStore } from '../../stores/uiStore'
import { useTreeStore } from '../../stores/treeStore'
import type { S3Connection } from '../../types'

interface S3ConnectionCardProps {
  connection: S3Connection
  onSelect: () => void
}

function S3ConnectionCard({ connection, onSelect }: S3ConnectionCardProps) {
  const cardBg = useColorModeValue('white', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const openDialog = useUIStore((state) => state.openDialog)

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openDialog('s3connection', { mode: 'edit', data: { connectionId: connection.id } })
  }

  return (
    <Card
      bg={cardBg}
      borderWidth={1}
      borderColor={borderColor}
      cursor="pointer"
      onClick={onSelect}
      transition="all 0.2s"
      _hover={{
        shadow: 'lg',
        borderColor: 'orange.300',
        transform: 'translateY(-2px)',
      }}
    >
      <CardBody>
        <VStack align="stretch" spacing={4}>
          {/* Header */}
          <HStack spacing={3}>
            <Box
              p={3}
              borderRadius="lg"
              bg="orange.50"
              color="orange.500"
            >
              <Icon as={SiAmazons3} boxSize={6} />
            </Box>
            <VStack align="start" spacing={0} flex={1}>
              <HStack>
                <Heading size="sm">{connection.name}</Heading>
                <Badge
                  colorScheme="green"
                  variant="subtle"
                  fontSize="xs"
                >
                  <HStack spacing={1}>
                    <Icon as={FiCheckCircle} boxSize={3} />
                    <Text>Connected</Text>
                  </HStack>
                </Badge>
              </HStack>
              <Text fontSize="xs" color="gray.500">
                {connection.endpoint}
              </Text>
            </VStack>
          </HStack>

          {/* Details */}
          <SimpleGrid columns={2} spacing={3}>
            <Box>
              <Text fontSize="xs" color="gray.500" mb={1}>Region</Text>
              <Text fontSize="sm" fontWeight="medium">
                {connection.region || 'Default'}
              </Text>
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.500" mb={1}>SSL</Text>
              <Badge colorScheme={connection.useSSL ? 'green' : 'gray'} size="sm">
                {connection.useSSL ? 'Enabled' : 'Disabled'}
              </Badge>
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.500" mb={1}>Path Style</Text>
              <Badge colorScheme={connection.pathStyle ? 'blue' : 'gray'} size="sm">
                {connection.pathStyle ? 'Yes' : 'No'}
              </Badge>
            </Box>
            <Box>
              <Text fontSize="xs" color="gray.500" mb={1}>Access Key</Text>
              <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
                {connection.accessKey.slice(0, 8)}...
              </Text>
            </Box>
          </SimpleGrid>

          {/* Actions */}
          <HStack pt={2} borderTopWidth={1} borderColor={borderColor}>
            <Button
              size="sm"
              variant="ghost"
              colorScheme="orange"
              onClick={handleEdit}
            >
              Edit
            </Button>
            <Spacer />
            <Button
              size="sm"
              colorScheme="orange"
              rightIcon={<FiHardDrive />}
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
              }}
            >
              View Buckets
            </Button>
          </HStack>
        </VStack>
      </CardBody>
    </Card>
  )
}

export default function S3StoragePanel() {
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)
  const selectNode = useTreeStore((state) => state.selectNode)
  const queryClient = useQueryClient()

  // Fetch S3 connections
  const { data: connections, isLoading } = useQuery({
    queryKey: ['s3connections'],
    queryFn: () => api.getS3Connections(),
  })

  // Fetch conversion tools status
  const { data: toolStatus } = useQuery({
    queryKey: ['conversionTools'],
    queryFn: () => api.getConversionToolStatus(),
  })

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['s3connections'] })
  }

  const handleSelectConnection = (connection: S3Connection) => {
    selectNode({
      id: `s3connection-${connection.id}`,
      name: connection.name,
      type: 's3connection',
      s3ConnectionId: connection.id,
    })
  }

  // Count available tools
  const availableTools = [
    toolStatus?.gdal?.available && 'GDAL',
    toolStatus?.pdal?.available && 'PDAL',
    toolStatus?.ogr2ogr?.available && 'ogr2ogr',
  ].filter(Boolean)

  if (isLoading) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Spinner size="xl" color="orange.500" thickness="4px" />
          <Text color="gray.500">Loading S3 connections...</Text>
        </VStack>
      </Center>
    )
  }

  return (
    <VStack spacing={6} align="stretch" p={4}>
      {/* Header Card */}
      <Card
        bg="linear-gradient(135deg, #c06c00 0%, #e08900 50%, #f0a020 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={SiAmazons3} boxSize={8} />
              </Box>
              <VStack align="start" spacing={1}>
                <Heading size="lg" color="white">S3 Storage</Heading>
                <Text opacity={0.9} fontSize="sm">
                  Manage your S3-compatible storage connections
                </Text>
              </VStack>
            </HStack>
            <Spacer />
            <HStack wrap="wrap" gap={2}>
              <Button
                variant="solid"
                bg="whiteAlpha.200"
                color="white"
                _hover={{ bg: 'whiteAlpha.300' }}
                leftIcon={<FiRefreshCw />}
                onClick={handleRefresh}
              >
                Refresh
              </Button>
              <Button
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiPlus />}
                onClick={() => openDialog('s3connection', { mode: 'create' })}
              >
                Add Connection
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      {/* Stats */}
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <Box
          bg={cardBg}
          p={4}
          borderRadius="xl"
          borderWidth={1}
          borderColor="gray.200"
          shadow="sm"
        >
          <HStack spacing={3} mb={2}>
            <Box p={2} borderRadius="lg" bg="orange.50" color="orange.500">
              <Icon as={SiAmazons3} boxSize={5} />
            </Box>
            <Text fontSize="sm" fontWeight="medium" color="gray.500">
              Connections
            </Text>
          </HStack>
          <Text fontSize="2xl" fontWeight="bold">
            {connections?.length || 0}
          </Text>
        </Box>

        <Box
          bg={cardBg}
          p={4}
          borderRadius="xl"
          borderWidth={1}
          borderColor="gray.200"
          shadow="sm"
        >
          <HStack spacing={3} mb={2}>
            <Box p={2} borderRadius="lg" bg="green.50" color="green.500">
              <Icon as={FiCheckCircle} boxSize={5} />
            </Box>
            <Text fontSize="sm" fontWeight="medium" color="gray.500">
              Active
            </Text>
          </HStack>
          <Text fontSize="2xl" fontWeight="bold">
            {connections?.filter(c => c.isActive !== false).length || 0}
          </Text>
        </Box>

        <Box
          bg={cardBg}
          p={4}
          borderRadius="xl"
          borderWidth={1}
          borderColor="gray.200"
          shadow="sm"
        >
          <HStack spacing={3} mb={2}>
            <Box
              p={2}
              borderRadius="lg"
              bg={availableTools.length > 0 ? 'green.50' : 'red.50'}
              color={availableTools.length > 0 ? 'green.500' : 'red.500'}
            >
              <Icon as={FiRefreshCw} boxSize={5} />
            </Box>
            <Text fontSize="sm" fontWeight="medium" color="gray.500">
              Conversion Tools
            </Text>
          </HStack>
          <Text fontSize="2xl" fontWeight="bold">
            {availableTools.length}
          </Text>
          <Text fontSize="xs" color="gray.400">
            {availableTools.join(', ') || 'None'}
          </Text>
        </Box>

        <Box
          bg={cardBg}
          p={4}
          borderRadius="xl"
          borderWidth={1}
          borderColor="gray.200"
          shadow="sm"
        >
          <HStack spacing={3} mb={2}>
            <Box p={2} borderRadius="lg" bg="blue.50" color="blue.500">
              <Icon as={FiHardDrive} boxSize={5} />
            </Box>
            <Text fontSize="sm" fontWeight="medium" color="gray.500">
              Cloud-Native
            </Text>
          </HStack>
          <Text fontSize="sm" fontWeight="bold">
            COG, COPC, GeoParquet
          </Text>
          <Text fontSize="xs" color="gray.400">
            Supported formats
          </Text>
        </Box>
      </SimpleGrid>

      {/* Connections Grid */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={SiAmazons3} color="orange.500" />
            <Text fontWeight="semibold" fontSize="lg">S3 Connections</Text>
            <Badge colorScheme="orange">{connections?.length || 0}</Badge>
          </HStack>

          {!connections || connections.length === 0 ? (
            <Center py={12}>
              <VStack spacing={4}>
                <Box
                  p={6}
                  borderRadius="full"
                  bg="orange.50"
                  color="orange.300"
                >
                  <Icon as={SiAmazons3} boxSize={12} />
                </Box>
                <VStack spacing={2}>
                  <Text fontWeight="medium" color="gray.600">
                    No S3 connections yet
                  </Text>
                  <Text fontSize="sm" color="gray.400" textAlign="center">
                    Add an S3-compatible storage connection to get started
                    with cloud-native geospatial data management.
                  </Text>
                </VStack>
                <Button
                  colorScheme="orange"
                  leftIcon={<FiPlus />}
                  onClick={() => openDialog('s3connection', { mode: 'create' })}
                >
                  Add S3 Connection
                </Button>
              </VStack>
            </Center>
          ) : (
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
              {connections.map((conn) => (
                <S3ConnectionCard
                  key={conn.id}
                  connection={conn}
                  onSelect={() => handleSelectConnection(conn)}
                />
              ))}
            </SimpleGrid>
          )}
        </CardBody>
      </Card>

      {/* Conversion Tools Status */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiRefreshCw} color="green.500" />
            <Text fontWeight="semibold" fontSize="lg">Cloud-Native Conversion Tools</Text>
          </HStack>
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
            {/* GDAL */}
            <Box
              p={4}
              borderRadius="lg"
              bg={toolStatus?.gdal?.available ? 'green.50' : 'red.50'}
              borderWidth={1}
              borderColor={toolStatus?.gdal?.available ? 'green.200' : 'red.200'}
            >
              <HStack mb={2}>
                <Icon
                  as={toolStatus?.gdal?.available ? FiCheckCircle : FiAlertCircle}
                  color={toolStatus?.gdal?.available ? 'green.500' : 'red.500'}
                />
                <Text fontWeight="medium">GDAL</Text>
              </HStack>
              <Text fontSize="sm" color="gray.600">
                {toolStatus?.gdal?.available
                  ? `COG conversion (${toolStatus.gdal.version?.split(' ')[0]})`
                  : 'Not available'}
              </Text>
            </Box>

            {/* PDAL */}
            <Box
              p={4}
              borderRadius="lg"
              bg={toolStatus?.pdal?.available ? 'green.50' : 'red.50'}
              borderWidth={1}
              borderColor={toolStatus?.pdal?.available ? 'green.200' : 'red.200'}
            >
              <HStack mb={2}>
                <Icon
                  as={toolStatus?.pdal?.available ? FiCheckCircle : FiAlertCircle}
                  color={toolStatus?.pdal?.available ? 'green.500' : 'red.500'}
                />
                <Text fontWeight="medium">PDAL</Text>
              </HStack>
              <Text fontSize="sm" color="gray.600">
                {toolStatus?.pdal?.available
                  ? `COPC conversion (${toolStatus.pdal.version?.split(' ')[0]})`
                  : 'Not available'}
              </Text>
            </Box>

            {/* ogr2ogr */}
            <Box
              p={4}
              borderRadius="lg"
              bg={toolStatus?.ogr2ogr?.available ? 'green.50' : 'red.50'}
              borderWidth={1}
              borderColor={toolStatus?.ogr2ogr?.available ? 'green.200' : 'red.200'}
            >
              <HStack mb={2}>
                <Icon
                  as={toolStatus?.ogr2ogr?.available ? FiCheckCircle : FiAlertCircle}
                  color={toolStatus?.ogr2ogr?.available ? 'green.500' : 'red.500'}
                />
                <Text fontWeight="medium">ogr2ogr</Text>
              </HStack>
              <Text fontSize="sm" color="gray.600">
                {toolStatus?.ogr2ogr?.available
                  ? 'GeoParquet conversion'
                  : 'Not available'}
              </Text>
            </Box>
          </SimpleGrid>
        </CardBody>
      </Card>
    </VStack>
  )
}

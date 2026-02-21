import { useState } from 'react'
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
  useToast,
  Input,
  FormControl,
} from '@chakra-ui/react'
import {
  FiHardDrive,
  FiUpload,
  FiPlus,
  FiCheckCircle,
  FiAlertCircle,
  FiArchive,
  FiRefreshCw,
} from 'react-icons/fi'
import { SiAmazons3 } from 'react-icons/si'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../../api/client'
import { useUIStore } from '../../stores/uiStore'

interface S3StatCardProps {
  label: string
  value: string | number
  helpText?: string
  icon: React.ElementType
  colorScheme?: string
}

function S3StatCard({ label, value, helpText, icon, colorScheme = 'orange' }: S3StatCardProps) {
  const bg = useColorModeValue('white', 'gray.700')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  return (
    <Box
      bg={bg}
      p={4}
      borderRadius="xl"
      borderWidth={1}
      borderColor={borderColor}
      shadow="sm"
      transition="all 0.2s"
      _hover={{ shadow: 'md', borderColor: `${colorScheme}.300` }}
    >
      <HStack spacing={3} mb={2}>
        <Box
          p={2}
          borderRadius="lg"
          bg={`${colorScheme}.50`}
          color={`${colorScheme}.500`}
        >
          <Icon as={icon} boxSize={5} />
        </Box>
        <Text fontSize="sm" fontWeight="medium" color="gray.500">
          {label}
        </Text>
      </HStack>
      <Text fontSize="2xl" fontWeight="bold">
        {value}
      </Text>
      {helpText && (
        <Text fontSize="xs" color="gray.400" mt={1}>
          {helpText}
        </Text>
      )}
    </Box>
  )
}

interface S3ConnectionPanelProps {
  connectionId: string
}

export default function S3ConnectionPanel({ connectionId }: S3ConnectionPanelProps) {
  const [newBucketName, setNewBucketName] = useState('')
  const [isCreatingBucket, setIsCreatingBucket] = useState(false)
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)
  const toast = useToast()
  const queryClient = useQueryClient()

  // Fetch connection details
  const { data: connection, isLoading: loadingConnection } = useQuery({
    queryKey: ['s3connection', connectionId],
    queryFn: () => api.getS3Connection(connectionId),
  })

  // Fetch buckets
  const { data: buckets, isLoading: loadingBuckets } = useQuery({
    queryKey: ['s3buckets', connectionId],
    queryFn: () => api.getS3Buckets(connectionId),
    enabled: !!connection,
  })

  // Fetch conversion tools status
  const { data: toolStatus } = useQuery({
    queryKey: ['conversionTools'],
    queryFn: () => api.getConversionToolStatus(),
  })

  const handleCreateBucket = async () => {
    if (!newBucketName.trim()) {
      toast({
        title: 'Bucket name required',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsCreatingBucket(true)
    try {
      await api.createS3Bucket(connectionId, newBucketName.trim())
      toast({
        title: 'Bucket created',
        description: `Successfully created bucket "${newBucketName}"`,
        status: 'success',
        duration: 3000,
      })
      setNewBucketName('')
      queryClient.invalidateQueries({ queryKey: ['s3buckets', connectionId] })
    } catch (err) {
      toast({
        title: 'Failed to create bucket',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsCreatingBucket(false)
    }
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['s3buckets', connectionId] })
  }

  if (loadingConnection) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Spinner size="xl" color="orange.500" thickness="4px" />
          <Text color="gray.500">Loading connection details...</Text>
        </VStack>
      </Center>
    )
  }

  if (!connection) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Icon as={FiAlertCircle} boxSize={12} color="red.500" />
          <Text color="red.500" fontWeight="medium">Connection not found</Text>
        </VStack>
      </Center>
    )
  }

  // Count available tools
  const availableTools = [
    toolStatus?.gdal?.available && 'GDAL',
    toolStatus?.pdal?.available && 'PDAL',
    toolStatus?.ogr2ogr?.available && 'ogr2ogr',
  ].filter(Boolean)

  return (
    <VStack spacing={6} align="stretch">
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
                <HStack spacing={3}>
                  <Heading size="lg" color="white">{connection.name}</Heading>
                  <Badge
                    colorScheme="green"
                    variant="solid"
                    fontSize="xs"
                    px={2}
                    py={1}
                    borderRadius="full"
                  >
                    <HStack spacing={1}>
                      <Icon as={FiCheckCircle} boxSize={3} />
                      <Text>Connected</Text>
                    </HStack>
                  </Badge>
                </HStack>
                <HStack spacing={3} opacity={0.9}>
                  <Text fontSize="sm">{connection.endpoint}</Text>
                  {connection.useSSL && (
                    <>
                      <Text fontSize="sm">|</Text>
                      <Text fontSize="sm">SSL</Text>
                    </>
                  )}
                  {connection.pathStyle && (
                    <>
                      <Text fontSize="sm">|</Text>
                      <Text fontSize="sm">Path Style</Text>
                    </>
                  )}
                </HStack>
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
                isLoading={loadingBuckets}
              >
                Refresh
              </Button>
              <Button
                variant="outline"
                color="white"
                borderColor="whiteAlpha.400"
                _hover={{ bg: 'whiteAlpha.200' }}
                leftIcon={<FiUpload />}
                onClick={() => openDialog('s3upload', {
                  mode: 'create',
                  data: { connectionId },
                })}
              >
                Upload
              </Button>
            </HStack>
          </Flex>
        </CardBody>
      </Card>

      {/* Stats */}
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <S3StatCard
          label="Buckets"
          value={buckets?.length || 0}
          icon={FiArchive}
          colorScheme="orange"
        />
        <S3StatCard
          label="Region"
          value={connection.region || 'Default'}
          icon={FiHardDrive}
          colorScheme="blue"
        />
        <S3StatCard
          label="Conversion Tools"
          value={availableTools.length}
          helpText={availableTools.join(', ') || 'None available'}
          icon={FiRefreshCw}
          colorScheme={availableTools.length > 0 ? 'green' : 'red'}
        />
        <S3StatCard
          label="SSL"
          value={connection.useSSL ? 'Enabled' : 'Disabled'}
          icon={FiCheckCircle}
          colorScheme={connection.useSSL ? 'green' : 'gray'}
        />
      </SimpleGrid>

      {/* Create Bucket */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiPlus} color="orange.500" />
            <Text fontWeight="semibold" fontSize="lg">Create New Bucket</Text>
          </HStack>
          <HStack>
            <FormControl>
              <Input
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
                placeholder="my-new-bucket"
                size="lg"
                borderRadius="lg"
              />
            </FormControl>
            <Button
              colorScheme="orange"
              onClick={handleCreateBucket}
              isLoading={isCreatingBucket}
              size="lg"
              px={8}
            >
              Create
            </Button>
          </HStack>
          <Text fontSize="xs" color="gray.500" mt={2}>
            Bucket names must be lowercase, 3-63 characters, and can contain letters, numbers, and hyphens.
          </Text>
        </CardBody>
      </Card>

      {/* Buckets List */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4}>
            <Icon as={FiArchive} color="yellow.600" />
            <Text fontWeight="semibold" fontSize="lg">Buckets</Text>
            <Badge colorScheme="orange">{buckets?.length || 0}</Badge>
          </HStack>
          {loadingBuckets ? (
            <Center py={8}>
              <Spinner color="orange.500" />
            </Center>
          ) : !buckets || buckets.length === 0 ? (
            <Center py={8}>
              <VStack spacing={2}>
                <Icon as={FiArchive} boxSize={10} color="gray.300" />
                <Text color="gray.500">No buckets found</Text>
                <Text fontSize="sm" color="gray.400">Create a bucket to get started</Text>
              </VStack>
            </Center>
          ) : (
            <VStack spacing={3} align="stretch">
              {buckets.map((bucket) => (
                <Box
                  key={bucket.name}
                  p={4}
                  borderRadius="lg"
                  bg={useColorModeValue('gray.50', 'gray.700')}
                  _hover={{ bg: useColorModeValue('orange.50', 'gray.600') }}
                  transition="all 0.2s"
                >
                  <HStack>
                    <Icon as={FiArchive} color="yellow.600" />
                    <VStack align="start" spacing={0} flex={1}>
                      <Text fontWeight="medium">{bucket.name}</Text>
                      <Text fontSize="xs" color="gray.500">
                        Created: {new Date(bucket.creationDate).toLocaleDateString()}
                      </Text>
                    </VStack>
                    <Button
                      size="sm"
                      variant="ghost"
                      colorScheme="orange"
                      leftIcon={<FiUpload />}
                      onClick={() => openDialog('s3upload', {
                        mode: 'create',
                        data: { connectionId, bucketName: bucket.name },
                      })}
                    >
                      Upload
                    </Button>
                  </HStack>
                </Box>
              ))}
            </VStack>
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

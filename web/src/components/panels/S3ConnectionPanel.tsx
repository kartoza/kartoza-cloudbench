import { useState } from 'react'
import {
  VStack,
  Card,
  CardBody,
  HStack,
  Box,
  Icon,
  IconButton,
  Heading,
  Text,
  Spacer,
  Button,
  Badge,
  SimpleGrid,
  Center,
  Spinner,
  Flex,
  Tooltip,
  useColorModeValue,
  useToast,
} from '@chakra-ui/react'
import {
  FiHardDrive,
  FiUpload,
  FiCheckCircle,
  FiAlertCircle,
  FiArchive,
  FiRefreshCw,
  FiFolder,
  FiFile,
  FiDownload,
  FiTrash2,
  FiMap,
  FiChevronRight,
  FiArrowLeft,
} from 'react-icons/fi'
import { SiAmazons3 } from 'react-icons/si'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import type { S3Object } from '../../types'
import { formatFileSize, isMapExplorerFormat } from '../../utils/s3ObjectFormat'

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
  const cardBg = useColorModeValue('white', 'gray.800')
  const objectBg = useColorModeValue('gray.50', 'gray.700')
  const objectHoverBg = useColorModeValue('orange.50', 'gray.600')
  const openDialog = useUIStore((state) => state.openDialog)
  const requestOpenMapExplorer = useUIStore((state) => state.requestOpenMapExplorer)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [prefix, setPrefix] = useState('')

  // Fetch connection details
  const { data: connection, isLoading: loadingConnection } = useQuery({
    queryKey: ['s3connection', connectionId],
    queryFn: () => api.getS3Connection(connectionId),
  })

  // Fetch objects for the current folder (prefix) within the connection's bucket
  const { data: objects, isLoading: loadingObjects } = useQuery({
    queryKey: ['s3objects', connectionId, prefix],
    queryFn: () => api.getS3Objects(connectionId, prefix),
    enabled: !!connection,
  })

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['s3connection', connectionId] })
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 's3objects' &&
        query.queryKey[1] === connectionId,
    })
  }

  const breadcrumbSegments = prefix.split('/').filter(Boolean)

  const handleBreadcrumbClick = (index: number) => {
    setPrefix(breadcrumbSegments.slice(0, index + 1).join('/') + '/')
  }

  const handleUp = () => {
    setPrefix(breadcrumbSegments.slice(0, -1).join('/') + (breadcrumbSegments.length > 1 ? '/' : ''))
  }

  const handleOpenFolder = (object: S3Object) => {
    setPrefix(object.key)
  }

  const handleDownload = async (object: S3Object) => {
    try {
      const result = await api.getS3PresignedURL(connectionId, object.key, 60 * 60)
      const link = document.createElement('a')
      link.href = result.url
      link.download = object.key.split('/').filter(Boolean).pop() || object.key
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      toast({
        title: 'Download failed',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    }
  }

  const handleDelete = (object: S3Object) => {
    const displayName = object.key.split('/').filter(Boolean).pop() || object.key
    openDialog('confirm', {
      mode: 'delete',
      title: object.isFolder ? 'Delete Folder' : 'Delete Object',
      message: object.isFolder
        ? `Are you sure you want to delete folder "${displayName}" and all its contents?`
        : `Are you sure you want to delete "${displayName}"?`,
      data: { s3ConnectionId: connectionId, s3ObjectKey: object.key },
    })
  }

  const handleOpenInMap = (object: S3Object) => {
    if (!connection) return
    requestOpenMapExplorer({ connectionId, bucketName: connection.bucket, key: object.key })
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
                  <Text fontSize="sm">|</Text>
                  <HStack spacing={1}>
                    <Icon as={FiArchive} boxSize={3} />
                    <Text fontSize="sm">{connection.bucket}</Text>
                  </HStack>
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
                isLoading={loadingConnection}
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
      <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
        <S3StatCard
          label="Bucket"
          value={connection.bucket}
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
          label="SSL"
          value={connection.useSSL ? 'Enabled' : 'Disabled'}
          icon={FiCheckCircle}
          colorScheme={connection.useSSL ? 'green' : 'gray'}
        />
      </SimpleGrid>

      {/* Objects */}
      <Card bg={cardBg}>
        <CardBody>
          <HStack mb={4} justify="space-between">
            <HStack spacing={2}>
              {prefix && (
                <Tooltip label="Up one level" fontSize="xs">
                  <IconButton
                    aria-label="Up one level"
                    icon={<FiArrowLeft size={14} />}
                    size="xs"
                    variant="ghost"
                    onClick={handleUp}
                  />
                </Tooltip>
              )}
              <Icon as={FiArchive} color="yellow.600" />
              <HStack spacing={1} fontSize="sm">
                <Text
                  fontWeight={breadcrumbSegments.length === 0 ? '600' : '400'}
                  color={breadcrumbSegments.length === 0 ? 'gray.800' : 'kartoza.600'}
                  cursor="pointer"
                  onClick={() => setPrefix('')}
                >
                  {connection.bucket}
                </Text>
                {breadcrumbSegments.map((segment, index) => (
                  <HStack key={index} spacing={1}>
                    <Icon as={FiChevronRight} boxSize={3} color="gray.400" />
                    <Text
                      fontWeight={index === breadcrumbSegments.length - 1 ? '600' : '400'}
                      color={index === breadcrumbSegments.length - 1 ? 'gray.800' : 'kartoza.600'}
                      cursor="pointer"
                      onClick={() => handleBreadcrumbClick(index)}
                    >
                      {segment}
                    </Text>
                  </HStack>
                ))}
              </HStack>
            </HStack>
            <Badge colorScheme="orange">{objects?.length || 0}</Badge>
          </HStack>

          {loadingObjects ? (
            <Center py={8}>
              <Spinner color="orange.500" />
            </Center>
          ) : !objects || objects.length === 0 ? (
            <Center py={8}>
              <VStack spacing={2}>
                <Icon as={FiArchive} boxSize={10} color="gray.300" />
                <Text color="gray.500">Empty folder</Text>
                <Text fontSize="sm" color="gray.400">Upload files to get started</Text>
              </VStack>
            </Center>
          ) : (
            <VStack spacing={2} align="stretch">
              {objects.map((object) => {
                const displayName = object.key.split('/').filter(Boolean).pop() || object.key
                const validDate = object.lastModified && !Number.isNaN(new Date(object.lastModified).getTime())
                return (
                  <Box
                    key={object.key}
                    p={3}
                    borderRadius="lg"
                    bg={objectBg}
                    _hover={{ bg: objectHoverBg }}
                    transition="all 0.2s"
                    cursor={object.isFolder ? 'pointer' : 'default'}
                    onClick={object.isFolder ? () => handleOpenFolder(object) : undefined}
                  >
                    <HStack>
                      <Icon as={object.isFolder ? FiFolder : FiFile} color={object.isFolder ? 'yellow.600' : 'gray.500'} />
                      <VStack align="start" spacing={0} flex={1} minW={0}>
                        <Text fontWeight="medium" noOfLines={1}>{displayName}</Text>
                        <Text fontSize="xs" color="gray.500">
                          {object.isFolder
                            ? 'Folder'
                            : `${formatFileSize(object.size)}${validDate ? ` · Updated ${new Date(object.lastModified).toLocaleDateString()}` : ''}`}
                        </Text>
                      </VStack>
                      {!object.isFolder && (
                        <HStack spacing={1} onClick={(e) => e.stopPropagation()}>
                          {isMapExplorerFormat(object.key) && (
                            <Tooltip label="Open in Map" fontSize="xs">
                              <IconButton
                                aria-label="Open in Map"
                                icon={<FiMap size={14} />}
                                size="xs"
                                variant="ghost"
                                colorScheme="teal"
                                onClick={() => handleOpenInMap(object)}
                              />
                            </Tooltip>
                          )}
                          <Tooltip label="Download" fontSize="xs">
                            <IconButton
                              aria-label="Download"
                              icon={<FiDownload size={14} />}
                              size="xs"
                              variant="ghost"
                              colorScheme="kartoza"
                              onClick={() => handleDownload(object)}
                            />
                          </Tooltip>
                          <Tooltip label="Delete" fontSize="xs">
                            <IconButton
                              aria-label="Delete"
                              icon={<FiTrash2 size={14} />}
                              size="xs"
                              variant="ghost"
                              colorScheme="red"
                              onClick={() => handleDelete(object)}
                            />
                          </Tooltip>
                        </HStack>
                      )}
                      {object.isFolder && (
                        <Tooltip label="Delete" fontSize="xs">
                          <IconButton
                            aria-label="Delete"
                            icon={<FiTrash2 size={14} />}
                            size="xs"
                            variant="ghost"
                            colorScheme="red"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(object)
                            }}
                          />
                        </Tooltip>
                      )}
                    </HStack>
                  </Box>
                )
              })}
            </VStack>
          )}
        </CardBody>
      </Card>
    </VStack>
  )
}

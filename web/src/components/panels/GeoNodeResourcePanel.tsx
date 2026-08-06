import { useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  HStack,
  Icon,
  Image,
  Link,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  SimpleGrid,
  Skeleton,
  Text,
  Tooltip,
  useColorModeValue,
  useToast,
  VStack,
} from '@chakra-ui/react'
import {
  FiBarChart2,
  FiBook,
  FiChevronDown,
  FiDownload,
  FiExternalLink,
  FiEye,
  FiFile,
  FiGlobe,
  FiLayers,
  FiMap,
} from 'react-icons/fi'
import { TbWorld } from 'react-icons/tb'
import type { TreeNode } from '../../types'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import { Panel } from "../Panel";
import { PanelHeader } from "../Panel/PanelHeader";
import { PanelBody } from "../Panel/PanelBody";

interface GeoNodeResourcePanelProps {
  node: TreeNode
}

export function GeoNodeResourcePanel({ node }: GeoNodeResourcePanelProps) {
  const cardBg = useColorModeValue('gray.50', 'gray.700')
  const toast = useToast()
  const [isDownloading, setIsDownloading] = useState(false)
  const setGeoNodePreview = useUIStore((state) => state.setGeoNodePreview)

  // Check if this dataset can be previewed via WMS
  const canPreviewMap = (node.type === 'geonodedataset' || node.type === 'geonodemap') &&
    node.geonodeAlternate &&
    node.geonodeUrl

  const handlePreviewMap = () => {
    if (!node.geonodeUrl || !node.geonodeAlternate || !node.geonodeConnectionId) {
      toast({
        title: 'Cannot preview',
        description: 'Missing required information for map preview',
        status: 'error',
        duration: 3000,
      })
      return
    }

    setGeoNodePreview({
      geonodeUrl: node.geonodeUrl,
      layerName: node.geonodeAlternate,
      workspace: node.geonodeAlternate.split(':')[0] || 'geonode',
      title: node.name,
      connectionId: node.geonodeConnectionId,
      detailUrl: node.geonodeDetailUrl,
    })
  }

  const getResourceIcon = () => {
    switch (node.type) {
      case 'geonodedataset':
        return FiLayers
      case 'geonodemap':
        return FiMap
      case 'geonodedocument':
        return FiFile
      case 'geonodegeostory':
        return FiBook
      case 'geonodedashboard':
        return FiBarChart2
      default:
        return FiGlobe
    }
  }

  const getResourceTypeBadge = () => {
    switch (node.type) {
      case 'geonodedataset':
        return { label: 'Dataset', colorScheme: 'blue' }
      case 'geonodemap':
        return { label: 'Map', colorScheme: 'green' }
      case 'geonodedocument':
        return { label: 'Document', colorScheme: 'gray' }
      case 'geonodegeostory':
        return { label: 'GeoStory', colorScheme: 'purple' }
      case 'geonodedashboard':
        return { label: 'Dashboard', colorScheme: 'orange' }
      default:
        return { label: 'Resource', colorScheme: 'teal' }
    }
  }

  const typeBadge = getResourceTypeBadge()

  const handleDownload = async (format: 'gpkg' | 'shp' | 'csv' | 'json' | 'xlsx') => {
    if (!node.geonodeConnectionId || !node.geonodeResourcePk || !node.geonodeAlternate) {
      toast({
        title: 'Missing information',
        description: 'Cannot download - missing connection or dataset information',
        status: 'error',
        duration: 3000,
      })
      return
    }

    setIsDownloading(true)
    try {
      const { blob, filename } = await api.downloadGeoNodeDataset(
        node.geonodeConnectionId,
        node.geonodeResourcePk,
        node.geonodeAlternate,
        format
      )

      // Create download link
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast({
        title: 'Download started',
        description: `Downloading ${filename}`,
        status: 'success',
        duration: 3000,
      })
    } catch (err) {
      toast({
        title: 'Download failed',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <Panel>
      <PanelHeader>
        {/* Header */}
        <HStack spacing={4}>
          <Box
            bg="linear-gradient(135deg, #0d7377 0%, #14919b 50%, #2dc2c9 100%)"
            p={3}
            borderRadius="xl"
          >
            <Icon as={TbWorld} boxSize={8} color="white"/>
          </Box>
          <Box flex="1">
            <HStack spacing={2} mb={1}>
              <Badge colorScheme={typeBadge.colorScheme} fontSize="xs">
                {typeBadge.label}
              </Badge>
              <Badge colorScheme="teal" variant="outline" fontSize="xs">
                GeoNode
              </Badge>
            </HStack>
            <Text fontSize="xl" fontWeight="600" noOfLines={2}>
              {node.name}
            </Text>
          </Box>
        </HStack>
      </PanelHeader>
      <PanelBody>
        {/* Thumbnail */}
        {node.geonodeThumbnailUrl && (
          <Card bg={cardBg} borderRadius="xl" overflow="hidden">
            <Image
              src={node.geonodeThumbnailUrl}
              alt={node.name}
              objectFit="cover"
              maxH="300px"
              w="100%"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              fallback={<Skeleton h="200px"/>}
              onError={(e) => {
                // Hide the image on error
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          </Card>
        )}

        {/* Resource Details */}
        <Card bg={cardBg} borderRadius="lg">
          <CardBody>
            <VStack align="stretch" spacing={3}>
              <HStack justify="space-between">
                <HStack spacing={2} color="gray.600">
                  <Icon as={getResourceIcon()}/>
                  <Text fontWeight="500">Type</Text>
                </HStack>
                <Text>{node.geonodeResourceType || typeBadge.label}</Text>
              </HStack>

              {node.geonodeResourcePk && (
                <HStack justify="space-between">
                  <Text fontWeight="500" color="gray.600">ID</Text>
                  <Text fontFamily="mono">{node.geonodeResourcePk}</Text>
                </HStack>
              )}

              {node.geonodeResourceUuid && (
                <HStack justify="space-between">
                  <Text fontWeight="500" color="gray.600">UUID</Text>
                  <Tooltip label={node.geonodeResourceUuid}>
                    <Text fontFamily="mono" fontSize="sm" noOfLines={1}>
                      {node.geonodeResourceUuid.slice(0, 8)}...
                    </Text>
                  </Tooltip>
                </HStack>
              )}
            </VStack>
          </CardBody>
        </Card>

        {/* Actions */}
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
          {node.geonodeDetailUrl && (
            <Button
              as={Link}
              href={node.geonodeDetailUrl}
              isExternal
              leftIcon={<FiExternalLink/>}
              colorScheme="teal"
              variant="outline"
              _hover={{ textDecor: 'none', bg: 'teal.50' }}
            >
              Open in GeoNode
            </Button>
          )}

          {/* WMS Preview button - for datasets and maps with alternate */}
          {canPreviewMap && (
            <Button
              leftIcon={<FiEye/>}
              colorScheme="teal"
              onClick={handlePreviewMap}
            >
              Preview Map
            </Button>
          )}

          {/* Download button - only for datasets */}
          {node.type === 'geonodedataset' && node.geonodeAlternate && (
            <Menu>
              <MenuButton
                as={Button}
                leftIcon={<FiDownload/>}
                rightIcon={<FiChevronDown/>}
                colorScheme="blue"
                isLoading={isDownloading}
              >
                Download
              </MenuButton>
              <MenuList>
                <MenuItem onClick={() => handleDownload('gpkg')}>
                  <HStack spacing={2}>
                    <Icon as={FiFile}/>
                    <Text>GeoPackage (.gpkg)</Text>
                  </HStack>
                </MenuItem>
                <MenuItem onClick={() => handleDownload('shp')}>
                  <HStack spacing={2}>
                    <Icon as={FiFile}/>
                    <Text>Shapefile (.shp)</Text>
                  </HStack>
                </MenuItem>
                <MenuItem onClick={() => handleDownload('json')}>
                  <HStack spacing={2}>
                    <Icon as={FiFile}/>
                    <Text>GeoJSON (.json)</Text>
                  </HStack>
                </MenuItem>
                <MenuItem onClick={() => handleDownload('csv')}>
                  <HStack spacing={2}>
                    <Icon as={FiFile}/>
                    <Text>CSV (.csv)</Text>
                  </HStack>
                </MenuItem>
                <MenuItem onClick={() => handleDownload('xlsx')}>
                  <HStack spacing={2}>
                    <Icon as={FiFile}/>
                    <Text>Excel (.xlsx)</Text>
                  </HStack>
                </MenuItem>
              </MenuList>
            </Menu>
          )}
        </SimpleGrid>

        {/* Info Cards */}
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <Card bg={cardBg} borderRadius="lg" p={4}>
            <HStack spacing={3}>
              <Box bg="teal.100" p={2} borderRadius="lg">
                <Icon as={FiLayers} color="teal.600"/>
              </Box>
              <Box>
                <Text fontSize="sm" color="gray.500">Resource Type</Text>
                <Text
                  fontWeight="600">{node.geonodeResourceType || typeBadge.label}</Text>
              </Box>
            </HStack>
          </Card>

          <Card bg={cardBg} borderRadius="lg" p={4}>
            <HStack spacing={3}>
              <Box bg="blue.100" p={2} borderRadius="lg">
                <Icon as={FiGlobe} color="blue.600"/>
              </Box>
              <Box>
                <Text fontSize="sm" color="gray.500">Connection</Text>
                <Text fontWeight="600" noOfLines={1}>
                  {node.geonodeConnectionId?.slice(0, 8)}...
                </Text>
              </Box>
            </HStack>
          </Card>
        </SimpleGrid>
      </PanelBody>
    </Panel>
  )
}

import { useState } from 'react'
import {
  VStack,
  Card,
  CardBody,
  Flex,
  HStack,
  Box,
  Icon,
  Heading,
  Text,
  Spacer,
  Stat,
  StatNumber,
  StatLabel,
  SimpleGrid,
  Button,
  Divider,
  Badge,
  useColorModeValue,
} from '@chakra-ui/react'
import { FiEdit3, FiPlus, FiUpload, FiDroplet } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import { useConnectionStore } from '../../stores/connectionStore'

interface StyleLegendPreviewProps {
  connectionId: string
  workspace: string
  styleName: string
  size?: number
}

function StyleLegendPreview({
  connectionId,
  workspace,
  styleName,
  size = 24
}: StyleLegendPreviewProps) {
  const [hasError, setHasError] = useState(false)
  const connections = useConnectionStore((state) => state.connections)
  const connection = connections.find((c) => c.id === connectionId)

  // Find a layer that uses this style
  const { data: layers } = useQuery({
    queryKey: ['layers', connectionId, workspace],
    queryFn: () => api.getLayers(connectionId, workspace),
    staleTime: 60000,
  })

  // Find a layer that has this style as default style
  const layerWithStyle = layers?.find(layer => layer.defaultStyle === styleName)

  if (!connection || hasError || !layerWithStyle) {
    return <Icon as={FiDroplet} color="pink.500" boxSize={`${size}px`} />
  }

  // Build the GeoServer base URL from connection URL (remove /rest suffix)
  const geoserverUrl = connection.url.replace(/\/rest\/?$/, '')
  // Use the layer we found with STYLE parameter to get the specific style's legend
  const legendUrl = `${geoserverUrl}/${workspace}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&LAYER=${workspace}:${layerWithStyle.name}&STYLE=${styleName}&FORMAT=image/png&WIDTH=${size}&HEIGHT=${size}&LEGEND_OPTIONS=forceLabels:off;fontAntiAliasing:true`

  return (
    <Box
      as="img"
      src={legendUrl}
      alt={styleName}
      w={`${size}px`}
      h={`${size}px`}
      minW={`${size}px`}
      minH={`${size}px`}
      borderRadius="sm"
      objectFit="contain"
      bg="white"
      border="1px solid"
      borderColor="gray.200"
      onError={() => setHasError(true)}
    />
  )
}

interface StylesDashboardProps {
  connectionId: string
  workspace: string
}

export default function StylesDashboard({
  connectionId,
  workspace,
}: StylesDashboardProps) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: styles } = useQuery({
    queryKey: ['styles', connectionId, workspace],
    queryFn: () => api.getStyles(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      <Card
        bg="surface.header"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiEdit3} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg" color="white">Styles</Heading>
                <Text color="white" opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{styles?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Styles</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <HStack spacing={4}>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus />}
          onClick={() => openDialog('style', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
          flex={1}
        >
          Create Style
        </Button>
        <Button
          size="lg"
          variant="outline"
          leftIcon={<FiUpload />}
          onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
          flex={1}
        >
          Upload SLD / CSS
        </Button>
      </HStack>

      {styles && styles.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Styles</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {styles.map((style) => (
                  <Card
                    key={style.name}
                    variant="outline"
                    size="sm"
                    cursor="pointer"
                    _hover={{ shadow: 'md', borderColor: 'kartoza.300' }}
                    transition="all 0.2s"
                    onClick={() => openDialog('style', { mode: 'edit', data: { connectionId, workspace, name: style.name } })}
                  >
                    <CardBody py={3} px={4}>
                      <HStack>
                        <StyleLegendPreview
                          connectionId={connectionId}
                          workspace={workspace}
                          styleName={style.name}
                          size={24}
                        />
                        <Text fontWeight="medium">{style.name}</Text>
                        {style.format && (
                          <Badge colorScheme="blue" size="sm">{style.format}</Badge>
                        )}
                      </HStack>
                    </CardBody>
                  </Card>
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

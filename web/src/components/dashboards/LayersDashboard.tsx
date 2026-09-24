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
  useColorModeValue,
} from '@chakra-ui/react'
import { FiLayers, FiUpload } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import LayerCard from '../cards/LayerCard'

interface LayersDashboardProps {
  connectionId: string
  workspace: string
}

export default function LayersDashboard({
  connectionId,
  workspace,
}: LayersDashboardProps) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: layers } = useQuery({
    queryKey: ['layers', connectionId, workspace],
    queryFn: () => api.getLayers(connectionId, workspace),
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
                <Icon as={FiLayers} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg" color="white">Layers</Heading>
                <Text color="white" opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{layers?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Published Layers</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <Button
        size="lg"
        variant="accent"
        leftIcon={<FiUpload />}
        onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
        py={8}
      >
        Upload New Layer Data
      </Button>

      {layers && layers.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Published Layers</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {layers.map((layer) => (
                  <LayerCard
                    key={layer.name}
                    name={layer.name}
                    connectionId={connectionId}
                    workspace={workspace}
                    enabled={layer.enabled}
                  />
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

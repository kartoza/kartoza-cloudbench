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
import { FiImage, FiPlus, FiUpload } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import StoreCard from '../cards/StoreCard'

interface CoverageStoresDashboardProps {
  connectionId: string
  workspace: string
}

export default function CoverageStoresDashboard({
  connectionId,
  workspace,
}: CoverageStoresDashboardProps) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: coveragestores } = useQuery({
    queryKey: ['coveragestores', connectionId, workspace],
    queryFn: () => api.getCoverageStores(connectionId, workspace),
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
                <Icon as={FiImage} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg" color="white">Coverage Stores</Heading>
                <Text color="white" opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{coveragestores?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Stores</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus />}
          onClick={() => openDialog('coveragestore', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
        >
          Create New Coverage Store
        </Button>
        <Button
          size="lg"
          variant="outline"
          leftIcon={<FiUpload />}
          onClick={() => openDialog('upload', { mode: 'create', data: { connectionId, workspace } })}
          py={8}
        >
          Upload GeoTIFF
        </Button>
      </SimpleGrid>

      {coveragestores && coveragestores.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Coverage Stores</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {coveragestores.map((store) => (
                  <StoreCard
                    key={store.name}
                    name={store.name}
                    type={store.type || 'GeoTIFF'}
                    enabled={store.enabled}
                    icon={FiImage}
                    connectionId={connectionId}
                    workspace={workspace}
                    storeType="coveragestore"
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

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
import { FiDatabase, FiPlus, FiUpload } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'
import StoreCard from '../cards/StoreCard'
import { PGEditorMode, PGStore } from "../dialogs/GeoServerDataStoreEditorDialog/types.ts";

interface DataStoresDashboardProps {
  connectionId: string
  workspace: string
}

export default function DataStoresDashboard({
  connectionId,
  workspace,
}: DataStoresDashboardProps) {
  const openDialog = useUIStore((state) => state.openDialog)
  const cardBg = useColorModeValue('white', 'gray.800')

  const { data: datastores } = useQuery({
    queryKey: ['datastores', connectionId, workspace],
    queryFn: () => api.getDataStores(connectionId, workspace),
  })

  return (
    <VStack spacing={6} align="stretch">
      {/* Dashboard Header */}
      <Card
        bg="linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"
        color="white"
      >
        <CardBody py={8} px={6}>
          <Flex align="center" wrap="wrap" gap={4}>
            <HStack spacing={4}>
              <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
                <Icon as={FiDatabase} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg" color="white">Data Stores</Heading>
                <Text color="white" opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{datastores?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Stores</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      {/* Action Buttons */}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus />}
          onClick={() => openDialog(PGStore.DATASTORE, { mode: PGEditorMode.CREATE, data: { connectionId, workspace } })}
          py={8}
        >
          Create New Data Store
        </Button>
        <Button
          size="lg"
          variant="outline"
          leftIcon={<FiUpload />}
          onClick={() => openDialog(PGStore.COVERAGE_STORE, { mode: PGEditorMode.CREATE, data: { connectionId, workspace } })}
          py={8}
        >
          Upload Shapefile / GeoPackage
        </Button>
      </SimpleGrid>

      {/* Store List */}
      {datastores && datastores.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Data Stores</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {datastores.map((store) => (
                  <StoreCard
                    key={store.name}
                    name={store.name}
                    type={store.type || 'Unknown'}
                    enabled={store.enabled}
                    icon={FiDatabase}
                    connectionId={connectionId}
                    workspace={workspace}
                    storeType="datastore"
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

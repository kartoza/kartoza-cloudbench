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
import { FiGrid, FiPlus } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'

interface LayerGroupsDashboardProps {
  connectionId: string
  workspace: string
}

export default function LayerGroupsDashboard({
  connectionId,
  workspace,
}: LayerGroupsDashboardProps) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: layergroups } = useQuery({
    queryKey: ['layergroups', connectionId, workspace],
    queryFn: () => api.getLayerGroups(connectionId, workspace),
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
                <Icon as={FiGrid} boxSize={8} />
              </Box>
              <VStack align="start" spacing={0}>
                <Heading size="lg" color="white">Layer Groups</Heading>
                <Text color="white" opacity={0.9}>Workspace: {workspace}</Text>
              </VStack>
            </HStack>
            <Spacer />
            <VStack align="end" spacing={2}>
              <Stat textAlign="right">
                <StatNumber fontSize="3xl">{layergroups?.length ?? 0}</StatNumber>
                <StatLabel color="whiteAlpha.800">Total Groups</StatLabel>
              </Stat>
            </VStack>
          </Flex>
        </CardBody>
      </Card>

      <Button
        size="lg"
        variant="accent"
        leftIcon={<FiPlus />}
        py={8}
        onClick={() =>
          openDialog('layergroup', {
            mode: 'create',
            data: { connectionId, workspace },
          })
        }
      >
        Create Layer Group
      </Button>

      {layergroups && layergroups.length > 0 && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={4}>
              <Heading size="sm" color="gray.600">Existing Layer Groups</Heading>
              <Divider />
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                {layergroups.map((group) => (
                  <Card key={group.name} variant="outline" size="sm">
                    <CardBody py={3} px={4}>
                      <HStack>
                        <Icon as={FiGrid} color="kartoza.500" />
                        <Text fontWeight="medium">{group.name}</Text>
                        {group.mode && (
                          <Badge colorScheme="purple" size="sm">{group.mode}</Badge>
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

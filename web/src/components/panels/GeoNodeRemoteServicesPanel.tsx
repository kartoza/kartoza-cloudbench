import {
  Box,
  Button,
  Card,
  CardBody,
  Center,
  Heading,
  HStack,
  Icon,
  Spacer,
  Spinner,
  Stat,
  StatLabel,
  StatNumber,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useColorModeValue,
  VStack,
} from '@chakra-ui/react'
import { FiAlertCircle, FiGlobe, FiPlus, FiTable } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from "../../stores/uiStore.ts";
import { useTreeStore } from "../../stores/treeStore";
import { Panel } from "../Panel";
import { PanelHeader } from "../Panel/PanelHeader";
import { PanelBody } from "../Panel/PanelBody";

interface Props {
  geonodeConnectionId: string
}


export default function GeoNodeRemoteServicesPanel({ geonodeConnectionId }: Props) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const tableBg = useColorModeValue('gray.50', 'gray.700')
  const headerBg = useColorModeValue('gray.100', 'gray.600')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  const openDialog = useUIStore((state) => state.openDialog)
  const selectNode = useTreeStore((state) => state.selectNode)
  const { data, isFetching: loading, error } = useQuery({
    queryKey: ['geonoderemoteservices', geonodeConnectionId],
    queryFn: () => api.getGeoNodeRemoteServices(geonodeConnectionId),
    enabled: true,
    staleTime: 30000,
  })

  if (loading) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Spinner size="xl" color="teal.500" thickness="4px"/>
          <Text color="gray.500">Loading data...</Text>
        </VStack>
      </Center>
    )
  }

  if (error) {
    return (
      <Center h="400px">
        <VStack spacing={4}>
          <Icon as={FiAlertCircle} boxSize={12} color="red.500"/>
          <Text color="red.500" fontWeight="medium">{error.message}</Text>
        </VStack>
      </Center>
    )
  }

  return (
    <Panel>
      <PanelHeader>
        <HStack spacing={4}>
          <Box bg="whiteAlpha.200" p={3} borderRadius="lg">
            <Icon as={FiGlobe} boxSize={8}/>
          </Box>
          <VStack align="start" spacing={1}>
            <HStack spacing={3}>
              <Heading size="lg" color="white">Remote Services</Heading>
            </HStack>
          </VStack>
        </HStack>
        <Spacer/>
        <Stat textAlign="right" p={0}>
          <StatNumber
            color="whiteAlpha.800"
            fontSize="3xl">{data?.services.length}</StatNumber>
          <StatLabel color="whiteAlpha.800">Services</StatLabel>
        </Stat>
      </PanelHeader>
      <PanelBody>
        <Card
          bg={cardBg} flex="1" overflow="hidden" minH={0} display="flex"
          flexDirection="column">
          <CardBody
            p={0} flex="1" minH={0} display="flex"
            flexDirection="column">
            {data?.services.length === 0 ? (
              <Center h="200px">
                <VStack spacing={2}>
                  <Icon as={FiTable} boxSize={8} color="gray.400"/>
                  <Text color="gray.500">No remote services.</Text>
                </VStack>
              </Center>
            ) : (
              <Box
                flex="1"
                minH={0}
                overflowY="auto"
                overflowX="auto"
              >
                <Table size="sm" variant="simple">
                  <Thead position="sticky" top={0} bg={headerBg} zIndex={1}>
                    <Tr>
                      <Th
                        borderColor={borderColor}
                        py={3}
                        fontSize="xs"
                        textTransform="none"
                        color="gray.500"
                        w="50px"
                      >
                        ID
                      </Th>
                      <Th
                        borderColor={borderColor}
                        py={3}
                        fontSize="xs"
                        whiteSpace="nowrap"
                      >
                        Name
                      </Th>
                      <Th
                        borderColor={borderColor}
                        py={3}
                        fontSize="xs"
                        whiteSpace="nowrap"
                      >
                        Type
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {data?.services.map((row, rowIdx) => (
                      <Tr
                        key={rowIdx}
                        _hover={{ bg: tableBg }}
                      >
                        <Td
                          borderColor={borderColor}
                          fontSize="xs"
                          color="gray.500"
                          py={2}
                        >
                          {row.id}
                        </Td>
                        <Td
                          borderColor={borderColor}
                          fontSize="xs"
                          py={2}
                          maxW="300px"
                          overflow="hidden"
                          textOverflow="ellipsis"
                          whiteSpace="nowrap"
                          cursor="pointer"
                          _hover={{
                            color: 'blue.500',
                            textDecoration: 'underline'
                          }}
                          onClick={() => selectNode({
                            id: `${row.id}`,
                            name: row.name,
                            type: 'geonoderemoteservice',
                            geonodeConnectionId,
                          })}
                        >
                          <Text as="span">
                            {row.name}
                          </Text>
                        </Td>

                        <Td
                          borderColor={borderColor}
                          fontSize="xs"
                          py={2}
                          maxW="300px"
                          overflow="hidden"
                          textOverflow="ellipsis"
                          whiteSpace="nowrap"
                        >
                          <Text
                            as="span"
                          >
                            {row.type}
                          </Text>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>

              </Box>
            )}
          </CardBody>
        </Card>
        <Button
          size="lg"
          variant="accent"
          leftIcon={<FiPlus/>}
          onClick={() => {
            openDialog('geonodeaddremoteservice', {
              mode: 'create',
              data: { connectionId: geonodeConnectionId },
            })
          }}
          py={8}
        >
          Create New Remote Service
        </Button>
      </PanelBody>
    </Panel>
  )
}

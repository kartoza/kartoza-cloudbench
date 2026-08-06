import {
  Box,
  Button,
  Card,
  CardBody,
  Center,
  Checkbox,
  Heading,
  HStack,
  Icon,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useColorModeValue,
  useToast,
  VStack,
} from '@chakra-ui/react'
import { FiAlertCircle, FiGlobe, FiPlus, FiTable } from 'react-icons/fi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../../api'
import { useState } from "react";
import { Panel } from "../Panel";
import { PanelHeader } from "../Panel/PanelHeader";
import { PanelBody } from "../Panel/PanelBody";

interface Props {
  geonodeConnectionId: string,
  serviceId: string,
  name: string,
}


export default function GeoNodeRemoteServicesDetailPanel(
  {
    geonodeConnectionId,
    serviceId,
    name
  }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const cardBg = useColorModeValue('white', 'gray.800')
  const tableBg = useColorModeValue('gray.50', 'gray.700')
  const headerBg = useColorModeValue('gray.100', 'gray.600')
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const { data, isFetching: loading, error } = useQuery({
    queryKey: ['geonoderemoteservice', geonodeConnectionId, serviceId],
    queryFn: () => api.getGeoNodeRemoteServiceResources(geonodeConnectionId, Number(serviceId)),
    enabled: true,
    staleTime: 30000,
  })

  const handleSubmit = async () => {
    if (!selected) return

    setIsSubmitting(true)
    try {
      await api.importGeoNodeRemoteServiceResources(geonodeConnectionId, Number(serviceId), selected)
      toast({ title: 'Resources added', status: 'success', duration: 2000 })
      queryClient.invalidateQueries({ queryKey: ['geonodedatasets', geonodeConnectionId] })
      queryClient.invalidateQueries({ queryKey: ['geonoderemoteservice', geonodeConnectionId, serviceId] })
    } catch (err) {
      const msg = (err as Error).message
      toast({
        title: 'Error',
        description: msg,
        status: 'error',
        duration: 5000
      })
    } finally {
      setIsSubmitting(false)
    }
  }

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
              <Heading size="lg" color="white">{name}</Heading>
            </HStack>
            <HStack spacing={3} opacity={0.9}>
              <Text fontSize="sm">Available resources</Text>
            </HStack>
          </VStack>
        </HStack>
      </PanelHeader>
      <PanelBody>
        <Card
          bg={cardBg} flex="1" overflow="hidden" minH={0} display="flex"
          flexDirection="column">
          <CardBody
            p={0} flex="1" minH={0} display="flex"
            flexDirection="column">
            {data?.resources.length === 0 ? (
              <Center h="200px">
                <VStack spacing={2}>
                  <Icon as={FiTable} boxSize={8} color="gray.400"/>
                  <Text color="gray.500">No available resources to be
                    imported.</Text>
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
                        textTransform="none"
                        color="gray.500"
                        w="50px"
                      >
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
                        Title
                      </Th>
                      <Th
                        borderColor={borderColor}
                        py={3}
                        fontSize="xs"
                        whiteSpace="nowrap"
                      >
                        Abstract
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
                    {data?.resources.map((row, rowIdx) => (
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
                          <Checkbox
                            isChecked={selected.includes(row.id)}
                            onChange={() =>
                              setSelected(prev =>
                                prev.includes(row.id)
                                  ? prev.filter(id => id !== row.id)
                                  : [...prev, row.id]
                              )
                            }
                          />
                        </Td>
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
                        >
                          <Text
                            as="span"
                          >
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
                            {row.title}
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
                            {row.abstract}
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
          disabled={!selected.length || isSubmitting}
          leftIcon={<FiPlus/>}
          onClick={handleSubmit}
          py={8}
        >
          Import selected resources {isSubmitting &&
          <Spinner size="md" color="white" thickness="2px" ml={4}/>}
        </Button>
      </PanelBody>
    </Panel>
  )
}

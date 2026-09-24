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
  Button,
  Badge,
  SimpleGrid,
  Divider,
  useColorModeValue,
} from '@chakra-ui/react'
import { FiEdit3 } from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { useUIStore } from '../../stores/uiStore'

interface StylePanelProps {
  connectionId: string
  workspace: string
  styleName: string
}

export default function StylePanel({
  connectionId,
  workspace,
  styleName,
}: StylePanelProps) {
  const cardBg = useColorModeValue('white', 'gray.800')
  const openDialog = useUIStore((state) => state.openDialog)

  const { data: styleContent } = useQuery({
    queryKey: ['style', connectionId, workspace, styleName],
    queryFn: () => api.getStyleContent(connectionId, workspace, styleName),
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
              <VStack align="start" spacing={1}>
                <Heading size="lg" color="white">{styleName}</Heading>
                <HStack>
                  <Badge colorScheme="pink">Style</Badge>
                  {styleContent?.format && (
                    <Badge colorScheme="blue">{styleContent.format.toUpperCase()}</Badge>
                  )}
                </HStack>
              </VStack>
            </HStack>
            <Spacer />
            <Button
              size="lg"
              variant="accent"
              leftIcon={<FiEdit3 />}
              onClick={() => openDialog('style', {
                mode: 'edit',
                data: { connectionId, workspace, name: styleName }
              })}
            >
              Edit Style
            </Button>
          </Flex>
        </CardBody>
      </Card>

      <Card bg={cardBg}>
        <CardBody>
          <VStack align="start" spacing={3}>
            <Heading size="sm" color="gray.600">Style Details</Heading>
            <Divider />
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} w="100%">
              <Box>
                <Text fontSize="xs" color="gray.500">Workspace</Text>
                <Text fontWeight="medium">{workspace}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" color="gray.500">Format</Text>
                <Text fontWeight="medium">{styleContent?.format?.toUpperCase() || 'Unknown'}</Text>
              </Box>
            </SimpleGrid>
          </VStack>
        </CardBody>
      </Card>

      {styleContent?.content && (
        <Card bg={cardBg}>
          <CardBody>
            <VStack align="stretch" spacing={3}>
              <Heading size="sm" color="gray.600">Style Content Preview</Heading>
              <Divider />
              <Box
                bg="gray.50"
                _dark={{ bg: 'gray.900' }}
                p={4}
                borderRadius="md"
                maxH="400px"
                overflowY="auto"
                fontFamily="mono"
                fontSize="sm"
                whiteSpace="pre-wrap"
                wordBreak="break-all"
              >
                {styleContent.content.slice(0, 2000)}
                {styleContent.content.length > 2000 && '...\n[Content truncated - click Edit Style to see full content]'}
              </Box>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )
}

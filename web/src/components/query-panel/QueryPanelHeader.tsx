// Query Panel Header Component

import {
  Flex,
  HStack,
  Box,
  Text,
  Badge,
  IconButton,
  Icon,
} from '@chakra-ui/react'
import { FiDatabase, FiX } from 'react-icons/fi'

interface QueryPanelHeaderProps {
  serviceName: string
  schemaCount: number
  onClose?: () => void
}

export const QueryPanelHeader: React.FC<QueryPanelHeaderProps> = ({
  serviceName,
  schemaCount,
  onClose,
}) => {
  return (
    <Flex
      bg="surface.header"
      px={6}
      py={4}
      align="center"
      justify="space-between"
    >
      <HStack spacing={3}>
        <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
          <Icon as={FiDatabase} boxSize={5} color="white" />
        </Box>
        <Box>
          <Text color="white" fontWeight="600" fontSize="lg">
            Query Designer
          </Text>
          <Text color="whiteAlpha.800" fontSize="sm">
            {serviceName}
          </Text>
        </Box>
      </HStack>
      <HStack spacing={2}>
        <Badge colorScheme="whiteAlpha" variant="subtle" px={3} py={1} borderRadius="sm">
          {schemaCount} schemas
        </Badge>
        {onClose && (
          <IconButton
            aria-label="Close"
            icon={<FiX />}
            variant="ghost"
            color="white"
            _hover={{ bg: 'whiteAlpha.200' }}
            onClick={onClose}
          />
        )}
      </HStack>
    </Flex>
  )
}

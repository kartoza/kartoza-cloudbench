import { useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  VStack,
  HStack,
  Text,
  Switch,
  FormControl,
  FormLabel,
  Box,
  Icon,
  Divider,
  Badge,
  Spinner,
} from '@chakra-ui/react'
import { FiSettings, FiEye, FiToggleRight } from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import { useUIStore } from '../../stores/uiStore'
import { useProvidersStore } from '../../stores/providersStore'

export default function AppSettingsDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const settings = useUIStore((state) => state.settings)
  const setShowHiddenPGServices = useUIStore((state) => state.setShowHiddenPGServices)

  const providers = useProvidersStore((state) => state.providers)
  const isProvidersLoading = useProvidersStore((state) => state.isLoading)
  const fetchProviders = useProvidersStore((state) => state.fetchProviders)
  const updateProviders = useProvidersStore((state) => state.updateProviders)

  const isOpen = activeDialog === 'settings'

  useEffect(() => {
    if (isOpen) {
      fetchProviders()
    }
  }, [isOpen, fetchProviders])

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="md" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        {/* Header */}
        <Box
          bg="surface.header"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={FiSettings} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                Settings
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                Configure application preferences
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={6} align="stretch">
            {/* Providers Section */}
            <Box>
              <HStack spacing={2} mb={4}>
                <Icon as={FiToggleRight} color="gray.600" />
                <Text fontWeight="600" color="gray.700">
                  Data Source Providers
                </Text>
                {isProvidersLoading && <Spinner size="xs" color="gray.400" />}
              </HStack>

              <VStack spacing={3} align="stretch">
                {providers.map((provider) => (
                  <FormControl
                    key={provider.id}
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <HStack spacing={2}>
                      <Box>
                        <HStack spacing={2}>
                          <FormLabel htmlFor={`provider-${provider.id}`} mb={0} cursor="pointer">
                            {provider.name}
                          </FormLabel>
                          {provider.experimental && (
                            <Badge colorScheme="orange" fontSize="2xs">
                              Experimental
                            </Badge>
                          )}
                        </HStack>
                        <Text fontSize="xs" color="gray.500">
                          {provider.description}
                        </Text>
                      </Box>
                    </HStack>
                    <Switch
                      id={`provider-${provider.id}`}
                      colorScheme="blue"
                      isChecked={provider.enabled}
                      isDisabled={isProvidersLoading}
                      onChange={(e) =>
                        updateProviders([{ id: provider.id, enabled: e.target.checked }])
                      }
                    />
                  </FormControl>
                ))}
              </VStack>
            </Box>

            <Divider />

            {/* PostgreSQL Section */}
            <Box>
              <HStack spacing={2} mb={4}>
                <Icon as={SiPostgresql} color="blue.600" />
                <Text fontWeight="600" color="gray.700">
                  PostgreSQL Services
                </Text>
              </HStack>

              <FormControl display="flex" alignItems="center" justifyContent="space-between">
                <HStack spacing={3}>
                  <Icon as={FiEye} color="gray.500" />
                  <Box>
                    <FormLabel htmlFor="show-hidden-pg" mb={0} cursor="pointer">
                      Show hidden services
                    </FormLabel>
                    <Text fontSize="xs" color="gray.500">
                      Display hidden PostgreSQL services in tree and dashboard
                    </Text>
                  </Box>
                </HStack>
                <Switch
                  id="show-hidden-pg"
                  colorScheme="blue"
                  isChecked={settings.showHiddenPGServices}
                  onChange={(e) => setShowHiddenPGServices(e.target.checked)}
                />
              </FormControl>
            </Box>

            <Divider />

            {/* Info Section */}
            <Box>
              <Text fontSize="sm" color="gray.500">
                Hidden services are commented out in your pg_service.conf file.
                They won't be used by applications but can be restored later.
              </Text>
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          <Button onClick={closeDialog} colorScheme="blue" borderRadius="lg">
            Done
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

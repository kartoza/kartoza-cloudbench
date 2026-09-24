import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  VStack,
  HStack,
  Box,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  SimpleGrid,
  Divider,
  Text,
  Icon,
  Spinner,
  useToast,
  InputGroup,
  InputLeftElement,
} from '@chakra-ui/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  FiUser,
  FiMail,
  FiPhone,
  FiMapPin,
  FiGlobe,
  FiBriefcase,
  FiHome,
} from 'react-icons/fi'
import * as api from '../../api'
import type { GeoServerContact } from '../../types'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  connectionId: string
  connectionName: string
}

export function SettingsDialog({
  isOpen,
  onClose,
  connectionId,
  connectionName,
}: SettingsDialogProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<GeoServerContact>({})

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', connectionId],
    queryFn: () => api.getContact(connectionId),
    enabled: isOpen && !!connectionId,
  })

  useEffect(() => {
    if (contact) {
      setFormData(contact)
    }
  }, [contact])

  const updateMutation = useMutation({
    mutationFn: (data: GeoServerContact) => api.updateContact(connectionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact', connectionId] })
      toast({
        title: 'Settings saved',
        description: 'Service metadata has been updated successfully.',
        status: 'success',
        duration: 3000,
      })
      onClose()
    },
    onError: (error: Error) => {
      toast({
        title: 'Error saving settings',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    },
  })

  const handleChange = (field: keyof GeoServerContact, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = () => {
    updateMutation.mutate(formData)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl" scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(4px)" />
      <ModalContent maxH="90vh">
        <ModalHeader
          bg="surface.header"
          color="white"
          borderTopRadius="md"
        >
          <HStack>
            <Icon as={FiBriefcase} />
            <Text>Service Metadata</Text>
          </HStack>
          <Text fontSize="sm" fontWeight="normal" opacity={0.9}>
            {connectionName}
          </Text>
        </ModalHeader>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          {isLoading ? (
            <VStack py={10}>
              <Spinner size="xl" color="kartoza.500" />
              <Text color="gray.500">Loading settings...</Text>
            </VStack>
          ) : (
            <Tabs colorScheme="kartoza" variant="enclosed">
              <TabList>
                <Tab>
                  <HStack>
                    <Icon as={FiUser} />
                    <Text>Contact</Text>
                  </HStack>
                </Tab>
                <Tab>
                  <HStack>
                    <Icon as={FiMapPin} />
                    <Text>Address</Text>
                  </HStack>
                </Tab>
                <Tab>
                  <HStack>
                    <Icon as={FiGlobe} />
                    <Text>Service</Text>
                  </HStack>
                </Tab>
              </TabList>

              <TabPanels>
                {/* Contact Tab */}
                <TabPanel>
                  <VStack spacing={6} align="stretch">
                    <Box>
                      <Text fontWeight="bold" color="gray.600" mb={3}>
                        Contact Person
                      </Text>
                      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                        <FormControl>
                          <FormLabel fontSize="sm">Name</FormLabel>
                          <InputGroup>
                            <InputLeftElement pointerEvents="none">
                              <Icon as={FiUser} color="gray.400" />
                            </InputLeftElement>
                            <Input
                              placeholder="John Smith"
                              value={formData.contactPerson || ''}
                              onChange={(e) => handleChange('contactPerson', e.target.value)}
                            />
                          </InputGroup>
                        </FormControl>

                        <FormControl>
                          <FormLabel fontSize="sm">Position</FormLabel>
                          <InputGroup>
                            <InputLeftElement pointerEvents="none">
                              <Icon as={FiBriefcase} color="gray.400" />
                            </InputLeftElement>
                            <Input
                              placeholder="GIS Administrator"
                              value={formData.contactPosition || ''}
                              onChange={(e) => handleChange('contactPosition', e.target.value)}
                            />
                          </InputGroup>
                        </FormControl>
                      </SimpleGrid>
                    </Box>

                    <Divider />

                    <Box>
                      <Text fontWeight="bold" color="gray.600" mb={3}>
                        Organization
                      </Text>
                      <FormControl>
                        <FormLabel fontSize="sm">Organization Name</FormLabel>
                        <InputGroup>
                          <InputLeftElement pointerEvents="none">
                            <Icon as={FiHome} color="gray.400" />
                          </InputLeftElement>
                          <Input
                            placeholder="Kartoza (Pty) Ltd"
                            value={formData.contactOrganization || ''}
                            onChange={(e) => handleChange('contactOrganization', e.target.value)}
                          />
                        </InputGroup>
                      </FormControl>
                    </Box>

                    <Divider />

                    <Box>
                      <Text fontWeight="bold" color="gray.600" mb={3}>
                        Contact Details
                      </Text>
                      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                        <FormControl>
                          <FormLabel fontSize="sm">Email</FormLabel>
                          <InputGroup>
                            <InputLeftElement pointerEvents="none">
                              <Icon as={FiMail} color="gray.400" />
                            </InputLeftElement>
                            <Input
                              type="email"
                              placeholder="info@example.com"
                              value={formData.contactEmail || ''}
                              onChange={(e) => handleChange('contactEmail', e.target.value)}
                            />
                          </InputGroup>
                        </FormControl>

                        <FormControl>
                          <FormLabel fontSize="sm">Phone</FormLabel>
                          <InputGroup>
                            <InputLeftElement pointerEvents="none">
                              <Icon as={FiPhone} color="gray.400" />
                            </InputLeftElement>
                            <Input
                              placeholder="+27 21 123 4567"
                              value={formData.contactVoice || ''}
                              onChange={(e) => handleChange('contactVoice', e.target.value)}
                            />
                          </InputGroup>
                        </FormControl>

                        <FormControl>
                          <FormLabel fontSize="sm">Fax</FormLabel>
                          <InputGroup>
                            <InputLeftElement pointerEvents="none">
                              <Icon as={FiPhone} color="gray.400" />
                            </InputLeftElement>
                            <Input
                              placeholder="+27 21 123 4568"
                              value={formData.contactFacsimile || ''}
                              onChange={(e) => handleChange('contactFacsimile', e.target.value)}
                            />
                          </InputGroup>
                        </FormControl>
                      </SimpleGrid>
                    </Box>
                  </VStack>
                </TabPanel>

                {/* Address Tab */}
                <TabPanel>
                  <VStack spacing={6} align="stretch">
                    <Box>
                      <Text fontWeight="bold" color="gray.600" mb={3}>
                        Location
                      </Text>
                      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                        <FormControl>
                          <FormLabel fontSize="sm">Address Type</FormLabel>
                          <Input
                            placeholder="Work"
                            value={formData.addressType || ''}
                            onChange={(e) => handleChange('addressType', e.target.value)}
                          />
                        </FormControl>

                        <FormControl gridColumn={{ md: 'span 2' }}>
                          <FormLabel fontSize="sm">Street Address</FormLabel>
                          <InputGroup>
                            <InputLeftElement pointerEvents="none">
                              <Icon as={FiMapPin} color="gray.400" />
                            </InputLeftElement>
                            <Input
                              placeholder="123 Main Street"
                              value={formData.address || ''}
                              onChange={(e) => handleChange('address', e.target.value)}
                            />
                          </InputGroup>
                        </FormControl>

                        <FormControl>
                          <FormLabel fontSize="sm">City</FormLabel>
                          <Input
                            placeholder="Cape Town"
                            value={formData.addressCity || ''}
                            onChange={(e) => handleChange('addressCity', e.target.value)}
                          />
                        </FormControl>

                        <FormControl>
                          <FormLabel fontSize="sm">State / Province</FormLabel>
                          <Input
                            placeholder="Western Cape"
                            value={formData.addressState || ''}
                            onChange={(e) => handleChange('addressState', e.target.value)}
                          />
                        </FormControl>

                        <FormControl>
                          <FormLabel fontSize="sm">Postal Code</FormLabel>
                          <Input
                            placeholder="8001"
                            value={formData.addressPostalCode || ''}
                            onChange={(e) => handleChange('addressPostalCode', e.target.value)}
                          />
                        </FormControl>

                        <FormControl>
                          <FormLabel fontSize="sm">Country</FormLabel>
                          <Input
                            placeholder="South Africa"
                            value={formData.addressCountry || ''}
                            onChange={(e) => handleChange('addressCountry', e.target.value)}
                          />
                        </FormControl>
                      </SimpleGrid>
                    </Box>
                  </VStack>
                </TabPanel>

                {/* Service Tab */}
                <TabPanel>
                  <VStack spacing={6} align="stretch">
                    <Box>
                      <Text fontWeight="bold" color="gray.600" mb={3}>
                        Online Presence
                      </Text>
                      <FormControl>
                        <FormLabel fontSize="sm">Online Resource (Website)</FormLabel>
                        <InputGroup>
                          <InputLeftElement pointerEvents="none">
                            <Icon as={FiGlobe} color="gray.400" />
                          </InputLeftElement>
                          <Input
                            type="url"
                            placeholder="https://www.example.com"
                            value={formData.onlineResource || ''}
                            onChange={(e) => handleChange('onlineResource', e.target.value)}
                          />
                        </InputGroup>
                      </FormControl>
                    </Box>

                    <Divider />

                    <Box>
                      <Text fontWeight="bold" color="gray.600" mb={3}>
                        Welcome Message
                      </Text>
                      <FormControl>
                        <FormLabel fontSize="sm">
                          Service Welcome Message
                        </FormLabel>
                        <InputGroup>
                          <Textarea
                            placeholder="Welcome to our GeoServer instance. This service provides access to..."
                            value={formData.welcome || ''}
                            onChange={(e) => handleChange('welcome', e.target.value)}
                            rows={6}
                          />
                        </InputGroup>
                        <Text fontSize="xs" color="gray.500" mt={1}>
                          This message will be displayed on the GeoServer welcome page
                        </Text>
                      </FormControl>
                    </Box>
                  </VStack>
                </TabPanel>
              </TabPanels>
            </Tabs>
          )}
        </ModalBody>

        <ModalFooter borderTop="1px" borderColor="gray.200">
          <HStack spacing={3}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="kartoza"
              onClick={handleSubmit}
              isLoading={updateMutation.isPending}
              loadingText="Saving..."
            >
              Save Changes
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

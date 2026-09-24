import { useEffect } from 'react'
import {
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  DrawerHeader,
  DrawerBody,
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Badge,
  Kbd,
  Table,
  Tbody,
  Tr,
  Td,
  Code,
  useColorModeValue,
  Icon,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Spinner,
} from '@chakra-ui/react'
import { AnimatePresence } from 'framer-motion'
import { FiHelpCircle, FiCommand, FiSearch, FiUpload, FiLayers, FiEdit3 } from 'react-icons/fi'
import { SiPostgresql } from 'react-icons/si'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api'
import { MarkdownContent } from './MarkdownContent'

interface HelpPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function HelpPanel({ isOpen, onClose }: HelpPanelProps) {
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  // Fetch documentation from the API
  const { data: docsData, isLoading } = useQuery({
    queryKey: ['documentation'],
    queryFn: api.getDocumentation,
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: isOpen, // Only fetch when panel is open
  })

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <Drawer
          isOpen={isOpen}
          placement="right"
          onClose={onClose}
          size="lg"
        >
          <DrawerOverlay bg="blackAlpha.400" backdropFilter="blur(2px)" />
          <DrawerContent bg={bgColor} maxW="600px">
            <DrawerCloseButton size="lg" />
            <DrawerHeader
              borderBottomWidth="1px"
              borderColor={borderColor}
              bg="surface.header"
              color="white"
            >
              <HStack spacing={3}>
                <Icon as={FiHelpCircle} boxSize={6} />
                <Text>Kartoza CloudBench Help</Text>
              </HStack>
            </DrawerHeader>
            <DrawerBody p={0} overflow="auto">
              {isLoading ? (
                <VStack py={10} spacing={4}>
                  <Spinner size="xl" color="kartoza.500" />
                  <Text color="gray.500">Loading documentation...</Text>
                </VStack>
              ) : docsData?.content ? (
                <Box p={6}>
                  <MarkdownContent content={docsData.content} />
                </Box>
              ) : (
                <QuickReferenceHelp />
              )}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}
    </AnimatePresence>
  )
}

// Fallback quick reference help when full docs aren't available
function QuickReferenceHelp() {
  const headingColor = useColorModeValue('kartoza.600', 'kartoza.300')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  return (
    <VStack align="stretch" spacing={6} p={6}>
      {/* Quick Start */}
      <Box>
        <HStack mb={4}>
          <Icon as={FiCommand} color="kartoza.500" boxSize={5} />
          <Heading size="md" color={headingColor}>
            Keyboard Shortcuts
          </Heading>
        </HStack>
        <Table size="sm" variant="simple">
          <Tbody>
            <Tr>
              <Td><Kbd>Ctrl</Kbd> + <Kbd>K</Kbd></Td>
              <Td>Open universal search</Td>
            </Tr>
            <Tr>
              <Td><Kbd>?</Kbd></Td>
              <Td>Toggle help panel</Td>
            </Tr>
            <Tr>
              <Td><Kbd>Tab</Kbd></Td>
              <Td>Switch between panels</Td>
            </Tr>
            <Tr>
              <Td><Kbd>Enter</Kbd></Td>
              <Td>Expand/select item</Td>
            </Tr>
            <Tr>
              <Td><Kbd>Esc</Kbd></Td>
              <Td>Close dialog/panel</Td>
            </Tr>
          </Tbody>
        </Table>
      </Box>

      {/* Features */}
      <Accordion allowMultiple>
        <AccordionItem border="none">
          <AccordionButton px={0}>
            <HStack flex={1}>
              <Icon as={FiSearch} color="kartoza.500" />
              <Text fontWeight="semibold">Universal Search</Text>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pl={6}>
            <Text mb={2}>
              Press <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> to search across all GeoServer connections and PostgreSQL services.
            </Text>
            <Text fontSize="sm" color="gray.500">
              Search for workspaces, layers, styles, tables, and more.
            </Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem border="none">
          <AccordionButton px={0}>
            <HStack flex={1}>
              <Icon as={FiLayers} color="kartoza.500" />
              <Text fontWeight="semibold">GeoServer Management</Text>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pl={6}>
            <VStack align="start" spacing={2}>
              <Text>Manage GeoServer resources:</Text>
              <HStack>
                <Badge colorScheme="blue">Workspaces</Badge>
                <Badge colorScheme="green">Data Stores</Badge>
                <Badge colorScheme="orange">Coverages</Badge>
              </HStack>
              <HStack>
                <Badge colorScheme="teal">Layers</Badge>
                <Badge colorScheme="purple">Styles</Badge>
                <Badge colorScheme="cyan">Layer Groups</Badge>
              </HStack>
            </VStack>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem border="none">
          <AccordionButton px={0}>
            <HStack flex={1}>
              <Icon as={SiPostgresql} color="blue.500" />
              <Text fontWeight="semibold">PostgreSQL Integration</Text>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pl={6}>
            <Text mb={2}>
              Connect to PostgreSQL databases via <Code>pg_service.conf</Code>.
            </Text>
            <Text fontSize="sm" color="gray.500">
              Browse schemas, tables, views, and columns. Import data using ogr2ogr and raster2pgsql.
            </Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem border="none">
          <AccordionButton px={0}>
            <HStack flex={1}>
              <Icon as={FiUpload} color="kartoza.500" />
              <Text fontWeight="semibold">Data Import</Text>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pl={6}>
            <Text mb={2}>Supported formats:</Text>
            <VStack align="start" spacing={1} fontSize="sm">
              <HStack>
                <Badge size="sm">Shapefile</Badge>
                <Badge size="sm">GeoPackage</Badge>
                <Badge size="sm">GeoJSON</Badge>
              </HStack>
              <HStack>
                <Badge size="sm">GeoTIFF</Badge>
                <Badge size="sm">KML/KMZ</Badge>
                <Badge size="sm">CSV</Badge>
              </HStack>
            </VStack>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem border="none">
          <AccordionButton px={0}>
            <HStack flex={1}>
              <Icon as={FiEdit3} color="kartoza.500" />
              <Text fontWeight="semibold">Style Editing</Text>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pl={6}>
            <Text mb={2}>Edit layer styles with:</Text>
            <VStack align="start" spacing={1} fontSize="sm">
              <Text>Visual Editor - WYSIWYG style designer</Text>
              <Text>Code Editor - SLD/CSS syntax highlighting</Text>
              <Text>Live Preview - Real-time WMS preview</Text>
            </VStack>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      {/* Footer */}
      <Box pt={4} borderTopWidth="1px" borderColor={borderColor}>
        <Text fontSize="sm" color="gray.500" textAlign="center">
          Kartoza CloudBench v0.14.0
        </Text>
        <Text fontSize="xs" color="gray.400" textAlign="center" mt={1}>
          Press <Kbd size="xs">?</Kbd> to toggle this help panel
        </Text>
      </Box>
    </VStack>
  )
}

// Hook for global ? shortcut
export function useHelpShortcut(onToggle: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're in an input or textarea
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (e.key === '?' && !isInput) {
        e.preventDefault()
        onToggle()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onToggle])
}

import { useState } from 'react'
import {
  Box,
  Card,
  Heading,
  Text,
  VStack,
  HStack,
  Spinner,
  IconButton,
  Tooltip,
  useColorModeValue,
  Alert,
  AlertIcon,
  AlertDescription,
  Badge,
  Icon,
} from '@chakra-ui/react'
import { FiRefreshCw, FiX, FiExternalLink, FiBook } from 'react-icons/fi'
import { TbSnowflake } from 'react-icons/tb'

interface JupyterPanelProps {
  connectionId: string
  connectionName: string
  jupyterUrl: string
  namespace?: string
  tableName?: string
  onClose?: () => void
}

export default function JupyterPanel({
  connectionName,
  jupyterUrl,
  namespace,
  tableName,
  onClose,
}: JupyterPanelProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [key, setKey] = useState(0)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  const handleRefresh = () => {
    setIsLoading(true)
    setHasError(false)
    setKey((prev) => prev + 1)
  }

  const handleOpenExternal = () => {
    window.open(jupyterUrl, '_blank', 'noopener,noreferrer')
  }

  const handleIframeLoad = () => {
    setIsLoading(false)
  }

  const handleIframeError = () => {
    setIsLoading(false)
    setHasError(true)
  }

  return (
    <Card bg={cardBg} borderColor={borderColor} borderWidth="1px" h="100%" overflow="hidden">
      <VStack spacing={0} h="100%">
        {/* Header */}
        <HStack
          w="100%"
          px={4}
          py={3}
          borderBottomWidth="1px"
          borderBottomColor={borderColor}
          justify="space-between"
          bg="surface.header"
        >
          <HStack spacing={3}>
            <Icon as={FiBook} boxSize={5} color="white" />
            <VStack align="start" spacing={0}>
              <Heading size="sm" color="white" noOfLines={1}>
                Jupyter Notebook
              </Heading>
              <HStack spacing={2}>
                <Text fontSize="xs" color="whiteAlpha.800">
                  {connectionName}
                </Text>
                {namespace && (
                  <>
                    <Text fontSize="xs" color="whiteAlpha.600">|</Text>
                    <Badge colorScheme="orange" variant="subtle" fontSize="2xs">
                      <HStack spacing={1}>
                        <Icon as={TbSnowflake} boxSize={2} />
                        <Text>{namespace}{tableName ? `.${tableName}` : ''}</Text>
                      </HStack>
                    </Badge>
                  </>
                )}
              </HStack>
            </VStack>
          </HStack>
          <HStack spacing={1}>
            <Tooltip label="Open in new tab">
              <IconButton
                aria-label="Open external"
                icon={<FiExternalLink />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleOpenExternal}
              />
            </Tooltip>
            <Tooltip label="Refresh">
              <IconButton
                aria-label="Refresh"
                icon={<FiRefreshCw />}
                size="sm"
                variant="ghost"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={handleRefresh}
              />
            </Tooltip>
            {onClose && (
              <Tooltip label="Close">
                <IconButton
                  aria-label="Close"
                  icon={<FiX />}
                  size="sm"
                  variant="ghost"
                  color="white"
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={onClose}
                />
              </Tooltip>
            )}
          </HStack>
        </HStack>

        {/* Jupyter iframe */}
        <Box flex={1} w="100%" position="relative">
          {isLoading && (
            <Box
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              display="flex"
              alignItems="center"
              justifyContent="center"
              bg={cardBg}
              zIndex={1}
            >
              <VStack spacing={4}>
                <Spinner size="xl" color="orange.500" thickness="3px" />
                <Text color="gray.500">Loading Jupyter environment...</Text>
              </VStack>
            </Box>
          )}

          {hasError ? (
            <Box
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              display="flex"
              alignItems="center"
              justifyContent="center"
              p={8}
            >
              <Alert status="error" borderRadius="lg" maxW="md">
                <AlertIcon />
                <AlertDescription>
                  <VStack align="start" spacing={2}>
                    <Text>Failed to load Jupyter notebook.</Text>
                    <Text fontSize="sm" color="gray.600">
                      Make sure the Jupyter server is running at {jupyterUrl}
                    </Text>
                  </VStack>
                </AlertDescription>
              </Alert>
            </Box>
          ) : (
            <Box
              as="iframe"
              key={key}
              src={jupyterUrl}
              w="100%"
              h="100%"
              border="none"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              title="Jupyter Notebook"
              allow="clipboard-read; clipboard-write"
              sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-downloads"
            />
          )}
        </Box>
      </VStack>
    </Card>
  )
}

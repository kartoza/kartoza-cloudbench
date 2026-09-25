import { useEffect, useState } from 'react'
import { Box, Card, CardBody, Flex, HStack, Heading, IconButton, Text, Tooltip, Spinner, Center, VStack, Icon, Code, useColorModeValue, useToast } from '@chakra-ui/react'
import { FiX, FiDownload, FiFile } from 'react-icons/fi'
import * as api from '../api'
import { MarkdownContent } from './MarkdownContent'
import { formatFileSize } from '../utils/s3ObjectFormat'

// Above this, don't try to render the content inline — just offer a download.
const MAX_PREVIEW_BYTES = 2_000_000

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'html', 'css',
  'js', 'jsx', 'ts', 'tsx', 'py', 'sql', 'sh', 'ini', 'toml', 'cfg', 'env',
])

type Kind = 'markdown' | 'json' | 'text' | 'unsupported'

function kindFor(key: string, size: number | undefined): Kind {
  if (size !== undefined && size > MAX_PREVIEW_BYTES) return 'unsupported'
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json') return 'json'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'unsupported'
}

interface S3TextPreviewProps {
  connectionId: string
  objectKey: string
  title: string
  size?: number
  lastModified?: string
  onClose?: () => void
}

export default function S3TextPreview({ connectionId, objectKey, title, size, lastModified, onClose }: S3TextPreviewProps) {
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cardBg = useColorModeValue('white', 'gray.800')
  const codeBg = useColorModeValue('gray.50', 'gray.900')
  const toast = useToast()

  const kind = kindFor(objectKey, size)
  const validDate = lastModified && !Number.isNaN(new Date(lastModified).getTime())

  useEffect(() => {
    if (kind === 'unsupported') {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    setContent(null)

    api.getS3PresignedURL(connectionId, objectKey)
      .then((result) => fetch(result.url))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to fetch object (${response.status})`)
        return response.text()
      })
      .then((text) => {
        setContent(text)
        setIsLoading(false)
      })
      .catch((err) => {
        setError((err as Error).message || 'Failed to load file')
        setIsLoading(false)
      })
  }, [connectionId, objectKey, kind])

  const handleDownload = async () => {
    try {
      const result = await api.getS3PresignedURL(connectionId, objectKey, 60 * 60)
      const link = document.createElement('a')
      link.href = result.url
      link.download = title
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      toast({ title: 'Download failed', description: (err as Error).message, status: 'error', duration: 5000 })
    }
  }

  const renderBody = () => {
    if (isLoading) {
      return (
        <Center py={16}>
          <Spinner color="kartoza.500" />
        </Center>
      )
    }
    if (error) {
      return (
        <Center py={16}>
          <Text color="red.500">{error}</Text>
        </Center>
      )
    }
    if (kind === 'unsupported' || content === null) {
      return (
        <Center py={16}>
          <VStack spacing={3}>
            <Icon as={FiFile} boxSize={10} color="gray.300" />
            <Text color="gray.500">
              {size !== undefined && size > MAX_PREVIEW_BYTES ? 'File is too large to preview' : 'Preview not available for this file type'}
            </Text>
            {(size !== undefined || validDate) && (
              <Text fontSize="sm" color="gray.400">
                {size !== undefined ? formatFileSize(size) : ''}
                {size !== undefined && validDate ? ' · ' : ''}
                {validDate ? `Updated ${new Date(lastModified!).toLocaleDateString()}` : ''}
              </Text>
            )}
          </VStack>
        </Center>
      )
    }
    if (kind === 'markdown') {
      return (
        <Box p={6}>
          <MarkdownContent content={content} />
        </Box>
      )
    }
    const formatted = kind === 'json' ? formatJson(content) : content
    return (
      <Box as="pre" bg={codeBg} p={4} m={4} borderRadius="md" overflowX="auto" fontSize="sm">
        <Code bg="transparent" display="block" whiteSpace="pre">
          {formatted}
        </Code>
      </Box>
    )
  }

  return (
    <Card bg={cardBg} flex="1" display="flex" flexDirection="column" minH="0">
      <CardBody display="flex" flexDirection="column" minH="0" p={0} overflow="auto">
        <Flex align="center" justify="space-between" px={4} py={3} flexShrink={0} bg="surface.header" color="white">
          <Heading size="sm" color="white" noOfLines={1}>{title}</Heading>
          <HStack spacing={1}>
            <Tooltip label="Download" fontSize="xs">
              <IconButton aria-label="Download" icon={<FiDownload size={14} />} size="sm" variant="ghost" color="white" _hover={{ bg: 'whiteAlpha.200' }} onClick={handleDownload} />
            </Tooltip>
            {onClose && (
              <Tooltip label="Close" fontSize="xs">
                <IconButton aria-label="Close" icon={<FiX size={16} />} size="sm" variant="ghost" color="white" _hover={{ bg: 'whiteAlpha.200' }} onClick={onClose} />
              </Tooltip>
            )}
          </HStack>
        </Flex>
        {renderBody()}
      </CardBody>
    </Card>
  )
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

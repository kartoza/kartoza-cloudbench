import { useEffect, useState } from 'react'
import { Box, Heading, Text, Code, Table, Thead, Tbody, Tr, Th, Td, Image, useColorModeValue } from '@chakra-ui/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownContentProps {
  content: string
  // Maps an image's src to the URL to load it from — e.g. a README's
  // relative "./thumbnail.png" to a presigned URL for the file beside it in
  // its bucket (relative paths would otherwise resolve against the app's own
  // URL). Return null to leave the src as written.
  resolveImageSrc?: (src: string) => Promise<string | null>
}

function MarkdownImage({
  src,
  alt,
  resolveImageSrc,
}: {
  src?: string
  alt?: string
  resolveImageSrc?: MarkdownContentProps['resolveImageSrc']
}) {
  const [resolved, setResolved] = useState<string | null>(resolveImageSrc ? null : src ?? null)

  useEffect(() => {
    if (!src || !resolveImageSrc) return
    let cancelled = false
    resolveImageSrc(src)
      .then((url) => {
        if (!cancelled) setResolved(url ?? src)
      })
      .catch(() => {
        if (!cancelled) setResolved(src)
      })
    return () => {
      cancelled = true
    }
  }, [src, resolveImageSrc])

  if (!resolved) return null
  return <Image src={resolved} alt={alt ?? ''} maxW="100%" maxH="360px" objectFit="contain" mb={3} />
}

// Shared Chakra-styled markdown renderer — used for both the in-app help
// docs and previewing .md files (e.g. a layer's generated README) from S3.
export function MarkdownContent({ content, resolveImageSrc }: MarkdownContentProps) {
  const borderColor = useColorModeValue('gray.200', 'gray.600')
  const headingColor = useColorModeValue('kartoza.600', 'kartoza.300')
  const codeBlockBg = useColorModeValue('gray.50', 'gray.900')

  return (
    <Box className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <Heading as="h1" size="xl" mt={6} mb={4} color={headingColor}>
              {children}
            </Heading>
          ),
          h2: ({ children }) => (
            <Heading as="h2" size="lg" mt={6} mb={3} color={headingColor} borderBottomWidth="1px" borderColor={borderColor} pb={2}>
              {children}
            </Heading>
          ),
          h3: ({ children }) => (
            <Heading as="h3" size="md" mt={4} mb={2} color={headingColor}>
              {children}
            </Heading>
          ),
          h4: ({ children }) => (
            <Heading as="h4" size="sm" mt={3} mb={2}>
              {children}
            </Heading>
          ),
          p: ({ children }) => (
            <Text mb={3} lineHeight="tall">
              {children}
            </Text>
          ),
          ul: ({ children }) => (
            <Box as="ul" pl={6} mb={3} listStyleType="disc">
              {children}
            </Box>
          ),
          ol: ({ children }) => (
            <Box as="ol" pl={6} mb={3} listStyleType="decimal">
              {children}
            </Box>
          ),
          li: ({ children }) => (
            <Box as="li" mb={1}>
              {children}
            </Box>
          ),
          code: ({ className, children }) => {
            const isInline = !className
            if (isInline) {
              return (
                <Code px={2} py={0.5} borderRadius="md" fontSize="sm">
                  {children}
                </Code>
              )
            }
            return (
              <Box as="pre" bg={codeBlockBg} p={4} borderRadius="md" overflowX="auto" mb={3} fontSize="sm">
                <Code bg="transparent" display="block" whiteSpace="pre">
                  {children}
                </Code>
              </Box>
            )
          },
          table: ({ children }) => (
            <Box overflowX="auto" mb={4}>
              <Table size="sm" variant="simple">
                {children}
              </Table>
            </Box>
          ),
          thead: ({ children }) => <Thead>{children}</Thead>,
          tbody: ({ children }) => <Tbody>{children}</Tbody>,
          tr: ({ children }) => <Tr>{children}</Tr>,
          th: ({ children }) => (
            <Th bg={codeBlockBg} fontWeight="semibold">
              {children}
            </Th>
          ),
          td: ({ children }) => <Td>{children}</Td>,
          blockquote: ({ children }) => (
            <Box pl={4} borderLeftWidth="4px" borderColor="kartoza.400" color="gray.600" fontStyle="italic" mb={3}>
              {children}
            </Box>
          ),
          hr: () => <Box as="hr" my={6} borderColor={borderColor} />,
          img: ({ src, alt }) => (
            <MarkdownImage
              src={typeof src === 'string' ? src : undefined}
              alt={alt}
              resolveImageSrc={resolveImageSrc}
            />
          ),
          a: ({ href, children }) => (
            <Text
              as="a"
              href={href}
              color="kartoza.500"
              textDecoration="underline"
              _hover={{ color: 'kartoza.600' }}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </Text>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  )
}

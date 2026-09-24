// AI Natural Language Query Mode Component

import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Select,
  Textarea,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Badge,
  Icon,
  Spinner,
  Wrap,
  WrapItem,
  Tag,
  TagLabel,
} from '@chakra-ui/react'
import { motion } from 'framer-motion'
import { FiZap, FiHelpCircle } from 'react-icons/fi'
import { SQLEditor } from '../SQLEditor'
import { springs } from '../../utils/animations'
import { AI_EXAMPLE_QUESTIONS } from './constants'
import type { SchemaInfo, AIResponse } from './types'

const MotionBox = motion(Box)

interface AIModeProps {
  serviceName: string
  schemas: SchemaInfo[]
  selectedSchema: string
  aiQuestion: string
  aiLoading: boolean
  aiProviderAvailable: boolean
  aiResponse: AIResponse | null
  sqlQuery: string
  onSchemaChange: (schema: string) => void
  onQuestionChange: (question: string) => void
  onSqlChange: (sql: string) => void
  onGenerateSQL: () => void
}

export const AIMode: React.FC<AIModeProps> = ({
  serviceName,
  schemas,
  selectedSchema,
  aiQuestion,
  aiLoading,
  aiProviderAvailable,
  aiResponse,
  sqlQuery,
  onSchemaChange,
  onQuestionChange,
  onSqlChange,
  onGenerateSQL,
}) => {
  return (
    <MotionBox
      key="ai"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={springs.snappy}
    >
      <VStack spacing={4} align="stretch">
        {/* AI Provider Status */}
        {!aiProviderAvailable && (
          <Alert status="warning" borderRadius="lg">
            <AlertIcon />
            <Box>
              <AlertTitle>Ollama not available</AlertTitle>
              <AlertDescription fontSize="sm">
                Start Ollama with: <code>ollama serve</code>
              </AlertDescription>
            </Box>
          </Alert>
        )}

        {/* Question Input */}
        <Box>
          <Text fontWeight="600" mb={2} fontSize="sm" color="gray.600">
            Ask a question about your data
          </Text>
          <Textarea
            value={aiQuestion}
            onChange={(e) => onQuestionChange(e.target.value)}
            placeholder="e.g., Show me all records where status is active..."
            rows={4}
            borderRadius="xl"
            _focus={{
              borderColor: 'purple.400',
              boxShadow: '0 0 0 3px rgba(84, 162, 204, 0.2)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onGenerateSQL()
              }
            }}
          />
        </Box>

        {/* Schema Selection */}
        <HStack>
          <Select
            value={selectedSchema}
            onChange={(e) => onSchemaChange(e.target.value)}
            size="sm"
            borderRadius="lg"
            flex={1}
          >
            {schemas.map(s => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </Select>
          <Button
            colorScheme="purple"
            leftIcon={aiLoading ? <Spinner size="sm" /> : <FiZap />}
            onClick={onGenerateSQL}
            isDisabled={!aiQuestion.trim() || aiLoading || !aiProviderAvailable}
            borderRadius="xl"
          >
            Generate SQL
          </Button>
        </HStack>

        {/* Example Questions */}
        <Box>
          <HStack mb={2}>
            <Icon as={FiHelpCircle} color="gray.400" />
            <Text fontSize="xs" color="gray.500">Examples</Text>
          </HStack>
          <Wrap spacing={2}>
            {AI_EXAMPLE_QUESTIONS.map((q, i) => (
              <WrapItem key={i}>
                <Tag
                  size="sm"
                  variant="subtle"
                  colorScheme="purple"
                  cursor="pointer"
                  onClick={() => onQuestionChange(q)}
                  _hover={{ bg: 'purple.100' }}
                  borderRadius="sm"
                >
                  <TagLabel>{q}</TagLabel>
                </Tag>
              </WrapItem>
            ))}
          </Wrap>
        </Box>

        {/* AI Response */}
        {aiResponse && (
          <MotionBox
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            bg="purple.50"
            p={4}
            borderRadius="xl"
            borderLeft="4px solid"
            borderLeftColor="purple.400"
          >
            {aiResponse.confidence !== undefined && (
              <HStack mb={2}>
                <Badge
                  colorScheme={
                    aiResponse.confidence >= 0.8 ? 'green' :
                    aiResponse.confidence >= 0.5 ? 'yellow' : 'red'
                  }
                >
                  {Math.round(aiResponse.confidence * 100)}% confidence
                </Badge>
              </HStack>
            )}
            {aiResponse.explanation && (
              <Text fontSize="sm" color="purple.700" mb={2}>
                {aiResponse.explanation}
              </Text>
            )}
            {aiResponse.warnings && aiResponse.warnings.length > 0 && (
              <Alert status="warning" size="sm" borderRadius="md" mb={2}>
                <AlertIcon />
                <VStack align="start" spacing={0}>
                  {aiResponse.warnings.map((w, i) => (
                    <Text key={i} fontSize="xs">{w}</Text>
                  ))}
                </VStack>
              </Alert>
            )}
          </MotionBox>
        )}

        {/* Generated SQL Preview */}
        {(aiResponse?.sql || sqlQuery) && (
          <Box>
            <Text fontWeight="600" mb={2} fontSize="sm" color="gray.600">
              Generated SQL
            </Text>
            <SQLEditor
              value={aiResponse?.sql || sqlQuery}
              onChange={onSqlChange}
              height="150px"
              serviceName={serviceName}
              schemas={schemas}
            />
          </Box>
        )}
      </VStack>
    </MotionBox>
  )
}

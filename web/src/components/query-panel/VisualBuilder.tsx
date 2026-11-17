// Visual Query Builder Component

import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  IconButton,
  Select,
  Input,
  Checkbox,
  Icon,
  useColorModeValue,
  Divider,
  Wrap,
  WrapItem,
  Tag,
  TagLabel,
  Flex,
} from '@chakra-ui/react'
import { motion } from 'framer-motion'
import {
  FiTable,
  FiColumns,
  FiFilter,
  FiArrowDown,
  FiPlus,
  FiTrash2,
  FiCopy,
} from 'react-icons/fi'
import { springs } from '../../utils/animations'
import { OPERATORS, AGGREGATES } from './constants'
import type { SchemaInfo, ColumnInfo, Column, Condition, OrderBy } from './types'

const MotionBox = motion(Box)

interface VisualBuilderProps {
  schemas: SchemaInfo[]
  selectedSchema: string
  selectedTable: string
  selectedColumns: Column[]
  conditions: Condition[]
  orderBy: OrderBy[]
  limit: number
  distinct: boolean
  generatedSQL: string
  currentSchema: SchemaInfo | undefined
  currentTable: { name: string; columns: ColumnInfo[]; has_geometry?: boolean } | undefined
  availableColumns: ColumnInfo[]
  onSchemaChange: (schema: string) => void
  onTableChange: (table: string) => void
  onColumnsChange: (columns: Column[]) => void
  onConditionsChange: (conditions: Condition[]) => void
  onOrderByChange: (orderBy: OrderBy[]) => void
  onLimitChange: (limit: number) => void
  onDistinctChange: (distinct: boolean) => void
  onCopySQL: () => void
}

export const VisualBuilder: React.FC<VisualBuilderProps> = ({
  schemas,
  selectedSchema,
  selectedTable,
  selectedColumns,
  conditions,
  orderBy,
  limit,
  distinct,
  generatedSQL,
  availableColumns,
  onSchemaChange,
  onTableChange,
  onColumnsChange,
  onConditionsChange,
  onOrderByChange,
  onLimitChange,
  onDistinctChange,
  onCopySQL,
  currentSchema,
  currentTable,
}) => {
  const tableBg = useColorModeValue('gray.50', 'gray.900')

  // Column handlers
  const addColumn = () => onColumnsChange([...selectedColumns, { name: '' }])
  const removeColumn = (index: number) => onColumnsChange(selectedColumns.filter((_, i) => i !== index))
  const updateColumn = (index: number, updates: Partial<Column>) => {
    const newColumns = [...selectedColumns]
    newColumns[index] = { ...newColumns[index], ...updates }
    onColumnsChange(newColumns)
  }

  // Condition handlers
  const addCondition = () => onConditionsChange([...conditions, { column: '', operator: '=', value: '', logic: 'AND' }])
  const removeCondition = (index: number) => onConditionsChange(conditions.filter((_, i) => i !== index))
  const updateCondition = (index: number, updates: Partial<Condition>) => {
    const newConditions = [...conditions]
    newConditions[index] = { ...newConditions[index], ...updates }
    onConditionsChange(newConditions)
  }

  // Order by handlers
  const addOrderBy = () => onOrderByChange([...orderBy, { column: '', direction: 'ASC' }])
  const removeOrderBy = (index: number) => onOrderByChange(orderBy.filter((_, i) => i !== index))
  const updateOrderBy = (index: number, updates: Partial<OrderBy>) => {
    const newOrderBy = [...orderBy]
    newOrderBy[index] = { ...newOrderBy[index], ...updates }
    onOrderByChange(newOrderBy)
  }

  return (
    <MotionBox
      key="visual"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={springs.snappy}
    >
      <VStack spacing={4} align="stretch">
        {/* Table Selection */}
        <HStack>
          <Box flex={1}>
            <Text fontSize="xs" fontWeight="600" color="gray.500" mb={1}>
              Schema
            </Text>
            <Select
              value={selectedSchema}
              onChange={(e) => {
                onSchemaChange(e.target.value)
                onTableChange('')
                onColumnsChange([])
                onConditionsChange([])
                onOrderByChange([])
              }}
              size="sm"
              borderRadius="lg"
            >
              {schemas.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </Select>
          </Box>
          <Box flex={2}>
            <Text fontSize="xs" fontWeight="600" color="gray.500" mb={1}>
              Table
            </Text>
            <Select
              value={selectedTable}
              onChange={(e) => {
                onTableChange(e.target.value)
                onColumnsChange([])
                onConditionsChange([])
                onOrderByChange([])
              }}
              size="sm"
              borderRadius="lg"
              placeholder="Select table..."
            >
              {currentSchema?.tables.map(t => (
                <option key={t.name} value={t.name}>
                  {t.name} {t.has_geometry && '(geo)'}
                </option>
              ))}
            </Select>
          </Box>
        </HStack>

        {/* Available Columns */}
        {currentTable && (
          <Box
            bg={tableBg}
            p={3}
            borderRadius="lg"
            maxH="120px"
            overflowY="auto"
          >
            <HStack mb={2}>
              <Icon as={FiColumns} color="gray.500" size="sm" />
              <Text fontSize="xs" fontWeight="600" color="gray.500">
                Available Columns ({availableColumns.length})
              </Text>
            </HStack>
            <Wrap spacing={1}>
              {availableColumns.map(col => (
                <WrapItem key={col.name}>
                  <Tag
                    size="sm"
                    variant="subtle"
                    colorScheme="gray"
                    cursor="pointer"
                    onClick={() => {
                      if (!selectedColumns.find(c => c.name === col.name)) {
                        onColumnsChange([...selectedColumns, { name: col.name }])
                      }
                    }}
                  >
                    <TagLabel>{col.name}</TagLabel>
                    <Text fontSize="2xs" color="gray.400" ml={1}>
                      {col.type}
                    </Text>
                  </Tag>
                </WrapItem>
              ))}
            </Wrap>
          </Box>
        )}

        {/* Selected Columns */}
        <Box>
          <Flex justify="space-between" align="center" mb={2}>
            <HStack>
              <Icon as={FiTable} color="blue.500" />
              <Text fontSize="sm" fontWeight="600">
                SELECT Columns
              </Text>
            </HStack>
            <Button
              size="xs"
              leftIcon={<FiPlus />}
              onClick={addColumn}
              variant="ghost"
              colorScheme="blue"
            >
              Add
            </Button>
          </Flex>
          {selectedColumns.length === 0 ? (
            <Text fontSize="sm" color="gray.500" fontStyle="italic">
              All columns (*)
            </Text>
          ) : (
            <VStack spacing={2} align="stretch">
              {selectedColumns.map((col, i) => (
                <HStack key={i}>
                  <Select
                    value={col.name}
                    onChange={(e) => updateColumn(i, { name: e.target.value })}
                    size="sm"
                    flex={2}
                    borderRadius="lg"
                  >
                    <option value="">Select...</option>
                    {availableColumns.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </Select>
                  <Select
                    value={col.aggregate || ''}
                    onChange={(e) => updateColumn(i, { aggregate: e.target.value })}
                    size="sm"
                    flex={1}
                    borderRadius="lg"
                  >
                    {AGGREGATES.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </Select>
                  <Input
                    value={col.alias || ''}
                    onChange={(e) => updateColumn(i, { alias: e.target.value })}
                    placeholder="alias"
                    size="sm"
                    flex={1}
                    borderRadius="lg"
                  />
                  <IconButton
                    aria-label="Remove"
                    icon={<FiTrash2 />}
                    size="sm"
                    variant="ghost"
                    colorScheme="red"
                    onClick={() => removeColumn(i)}
                  />
                </HStack>
              ))}
            </VStack>
          )}
        </Box>

        <Divider />

        {/* WHERE Conditions */}
        <Box>
          <Flex justify="space-between" align="center" mb={2}>
            <HStack>
              <Icon as={FiFilter} color="orange.500" />
              <Text fontSize="sm" fontWeight="600">
                WHERE Conditions
              </Text>
            </HStack>
            <Button
              size="xs"
              leftIcon={<FiPlus />}
              onClick={addCondition}
              variant="ghost"
              colorScheme="orange"
            >
              Add
            </Button>
          </Flex>
          {conditions.length === 0 ? (
            <Text fontSize="sm" color="gray.500" fontStyle="italic">
              No conditions
            </Text>
          ) : (
            <VStack spacing={2} align="stretch">
              {conditions.map((cond, i) => (
                <HStack key={i} flexWrap="wrap">
                  {i > 0 && (
                    <Select
                      value={cond.logic}
                      onChange={(e) => updateCondition(i, { logic: e.target.value as 'AND' | 'OR' })}
                      size="sm"
                      w="80px"
                      borderRadius="lg"
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </Select>
                  )}
                  <Select
                    value={cond.column}
                    onChange={(e) => updateCondition(i, { column: e.target.value })}
                    size="sm"
                    flex={1}
                    minW="100px"
                    borderRadius="lg"
                  >
                    <option value="">Column...</option>
                    {availableColumns.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </Select>
                  <Select
                    value={cond.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value })}
                    size="sm"
                    w="150px"
                    borderRadius="lg"
                  >
                    {OPERATORS.map(op => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </Select>
                  {!['IS NULL', 'IS NOT NULL'].includes(cond.operator) && (
                    <Input
                      value={cond.value}
                      onChange={(e) => updateCondition(i, { value: e.target.value })}
                      placeholder="value"
                      size="sm"
                      flex={1}
                      minW="80px"
                      borderRadius="lg"
                    />
                  )}
                  <IconButton
                    aria-label="Remove"
                    icon={<FiTrash2 />}
                    size="sm"
                    variant="ghost"
                    colorScheme="red"
                    onClick={() => removeCondition(i)}
                  />
                </HStack>
              ))}
            </VStack>
          )}
        </Box>

        <Divider />

        {/* ORDER BY */}
        <Box>
          <Flex justify="space-between" align="center" mb={2}>
            <HStack>
              <Icon as={FiArrowDown} color="green.500" />
              <Text fontSize="sm" fontWeight="600">
                ORDER BY
              </Text>
            </HStack>
            <Button
              size="xs"
              leftIcon={<FiPlus />}
              onClick={addOrderBy}
              variant="ghost"
              colorScheme="green"
            >
              Add
            </Button>
          </Flex>
          {orderBy.length === 0 ? (
            <Text fontSize="sm" color="gray.500" fontStyle="italic">
              No sorting
            </Text>
          ) : (
            <VStack spacing={2} align="stretch">
              {orderBy.map((ob, i) => (
                <HStack key={i}>
                  <Select
                    value={ob.column}
                    onChange={(e) => updateOrderBy(i, { column: e.target.value })}
                    size="sm"
                    flex={2}
                    borderRadius="lg"
                  >
                    <option value="">Column...</option>
                    {availableColumns.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </Select>
                  <Select
                    value={ob.direction}
                    onChange={(e) => updateOrderBy(i, { direction: e.target.value as 'ASC' | 'DESC' })}
                    size="sm"
                    w="100px"
                    borderRadius="lg"
                  >
                    <option value="ASC">ASC</option>
                    <option value="DESC">DESC</option>
                  </Select>
                  <IconButton
                    aria-label="Remove"
                    icon={<FiTrash2 />}
                    size="sm"
                    variant="ghost"
                    colorScheme="red"
                    onClick={() => removeOrderBy(i)}
                  />
                </HStack>
              ))}
            </VStack>
          )}
        </Box>

        <Divider />

        {/* Options */}
        <HStack spacing={4}>
          <Checkbox
            isChecked={distinct}
            onChange={(e) => onDistinctChange(e.target.checked)}
            size="sm"
          >
            DISTINCT
          </Checkbox>
          <HStack>
            <Text fontSize="sm">LIMIT:</Text>
            <Input
              type="number"
              value={limit}
              onChange={(e) => onLimitChange(parseInt(e.target.value) || 100)}
              size="sm"
              w="80px"
              borderRadius="lg"
              min={1}
              max={10000}
            />
          </HStack>
        </HStack>

        {/* Generated SQL Preview */}
        {generatedSQL && (
          <Box>
            <HStack justify="space-between" mb={2}>
              <Text fontSize="sm" fontWeight="600" color="gray.600">
                Generated SQL
              </Text>
              <IconButton
                aria-label="Copy"
                icon={<FiCopy />}
                size="xs"
                variant="ghost"
                onClick={onCopySQL}
              />
            </HStack>
            <Box
              bg="gray.900"
              color="gray.100"
              p={3}
              borderRadius="lg"
              fontSize="xs"
              fontFamily="mono"
              whiteSpace="pre-wrap"
              maxH="150px"
              overflow="auto"
            >
              {generatedSQL}
            </Box>
          </Box>
        )}
      </VStack>
    </MotionBox>
  )
}

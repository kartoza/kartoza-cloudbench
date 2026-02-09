import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  Box,
  Flex,
  VStack,
  HStack,
  FormControl,
  FormLabel,
  Input,
  Select,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Text,
  Icon,
  Badge,
  useToast,
  useColorModeValue,
  IconButton,
  Divider,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Alert,
  AlertIcon,
  Spinner,
} from '@chakra-ui/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { xml } from '@codemirror/lang-xml'
import { css } from '@codemirror/lang-css'
import {
  FiDroplet,
  FiCode,
  FiEye,
  FiSave,
  FiSquare,
  FiCircle,
  FiMinus,
} from 'react-icons/fi'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api/client'

// Default SLD template for new styles
const DEFAULT_SLD = `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>NewStyle</Name>
    <UserStyle>
      <Title>New Style</Title>
      <FeatureTypeStyle>
        <Rule>
          <Name>Default</Name>
          <PolygonSymbolizer>
            <Fill>
              <CssParameter name="fill">#3388ff</CssParameter>
              <CssParameter name="fill-opacity">0.6</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">#2266cc</CssParameter>
              <CssParameter name="stroke-width">1</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`

// Default CSS template for new styles
const DEFAULT_CSS = `/* GeoServer CSS Style */
* {
  fill: #3388ff;
  fill-opacity: 0.6;
  stroke: #2266cc;
  stroke-width: 1;
}`

// Style rule interface for visual editor
interface StyleRule {
  name: string
  filter?: string
  symbolizer: {
    type: 'polygon' | 'line' | 'point'
    fill?: string
    fillOpacity?: number
    stroke?: string
    strokeWidth?: number
    strokeOpacity?: number
    pointShape?: 'circle' | 'square' | 'triangle' | 'star' | 'cross'
    pointSize?: number
  }
}

// Parse SLD to extract style rules for visual editing
function parseSLDRules(sldContent: string): StyleRule[] {
  const rules: StyleRule[] = []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(sldContent, 'text/xml')
    const ruleElements = doc.querySelectorAll('Rule')

    ruleElements.forEach((ruleEl, index) => {
      const nameEl = ruleEl.querySelector('Name')
      const rule: StyleRule = {
        name: nameEl?.textContent || `Rule ${index + 1}`,
        symbolizer: { type: 'polygon' }
      }

      // Parse PolygonSymbolizer
      const polySymb = ruleEl.querySelector('PolygonSymbolizer')
      if (polySymb) {
        rule.symbolizer.type = 'polygon'
        const fillParams = polySymb.querySelectorAll('Fill CssParameter')
        fillParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'fill') rule.symbolizer.fill = param.textContent || '#3388ff'
          if (name === 'fill-opacity') rule.symbolizer.fillOpacity = parseFloat(param.textContent || '1')
        })
        const strokeParams = polySymb.querySelectorAll('Stroke CssParameter')
        strokeParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'stroke') rule.symbolizer.stroke = param.textContent || '#2266cc'
          if (name === 'stroke-width') rule.symbolizer.strokeWidth = parseFloat(param.textContent || '1')
          if (name === 'stroke-opacity') rule.symbolizer.strokeOpacity = parseFloat(param.textContent || '1')
        })
      }

      // Parse LineSymbolizer
      const lineSymb = ruleEl.querySelector('LineSymbolizer')
      if (lineSymb) {
        rule.symbolizer.type = 'line'
        const strokeParams = lineSymb.querySelectorAll('Stroke CssParameter')
        strokeParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'stroke') rule.symbolizer.stroke = param.textContent || '#3388ff'
          if (name === 'stroke-width') rule.symbolizer.strokeWidth = parseFloat(param.textContent || '2')
          if (name === 'stroke-opacity') rule.symbolizer.strokeOpacity = parseFloat(param.textContent || '1')
        })
      }

      // Parse PointSymbolizer
      const pointSymb = ruleEl.querySelector('PointSymbolizer')
      if (pointSymb) {
        rule.symbolizer.type = 'point'
        rule.symbolizer.pointShape = 'circle'
        rule.symbolizer.pointSize = 8

        const fillParams = pointSymb.querySelectorAll('Fill CssParameter')
        fillParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'fill') rule.symbolizer.fill = param.textContent || '#3388ff'
          if (name === 'fill-opacity') rule.symbolizer.fillOpacity = parseFloat(param.textContent || '1')
        })
        const strokeParams = pointSymb.querySelectorAll('Stroke CssParameter')
        strokeParams.forEach(param => {
          const name = param.getAttribute('name')
          if (name === 'stroke') rule.symbolizer.stroke = param.textContent || '#2266cc'
          if (name === 'stroke-width') rule.symbolizer.strokeWidth = parseFloat(param.textContent || '1')
        })
        const sizeEl = pointSymb.querySelector('Size')
        if (sizeEl) rule.symbolizer.pointSize = parseFloat(sizeEl.textContent || '8')
      }

      rules.push(rule)
    })
  } catch (e) {
    console.error('Failed to parse SLD:', e)
  }

  return rules.length > 0 ? rules : [{
    name: 'Default',
    symbolizer: {
      type: 'polygon',
      fill: '#3388ff',
      fillOpacity: 0.6,
      stroke: '#2266cc',
      strokeWidth: 1,
    }
  }]
}

// Generate SLD from style rules
function generateSLD(styleName: string, rules: StyleRule[]): string {
  let rulesXml = ''

  rules.forEach(rule => {
    let symbolizerXml = ''

    if (rule.symbolizer.type === 'polygon') {
      symbolizerXml = `
          <PolygonSymbolizer>
            <Fill>
              <CssParameter name="fill">${rule.symbolizer.fill || '#3388ff'}</CssParameter>
              <CssParameter name="fill-opacity">${rule.symbolizer.fillOpacity ?? 0.6}</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">${rule.symbolizer.stroke || '#2266cc'}</CssParameter>
              <CssParameter name="stroke-width">${rule.symbolizer.strokeWidth || 1}</CssParameter>
            </Stroke>
          </PolygonSymbolizer>`
    } else if (rule.symbolizer.type === 'line') {
      symbolizerXml = `
          <LineSymbolizer>
            <Stroke>
              <CssParameter name="stroke">${rule.symbolizer.stroke || '#3388ff'}</CssParameter>
              <CssParameter name="stroke-width">${rule.symbolizer.strokeWidth || 2}</CssParameter>
              <CssParameter name="stroke-opacity">${rule.symbolizer.strokeOpacity ?? 1}</CssParameter>
            </Stroke>
          </LineSymbolizer>`
    } else if (rule.symbolizer.type === 'point') {
      symbolizerXml = `
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>${rule.symbolizer.pointShape || 'circle'}</WellKnownName>
                <Fill>
                  <CssParameter name="fill">${rule.symbolizer.fill || '#3388ff'}</CssParameter>
                  <CssParameter name="fill-opacity">${rule.symbolizer.fillOpacity ?? 1}</CssParameter>
                </Fill>
                <Stroke>
                  <CssParameter name="stroke">${rule.symbolizer.stroke || '#2266cc'}</CssParameter>
                  <CssParameter name="stroke-width">${rule.symbolizer.strokeWidth || 1}</CssParameter>
                </Stroke>
              </Mark>
              <Size>${rule.symbolizer.pointSize || 8}</Size>
            </Graphic>
          </PointSymbolizer>`
    }

    rulesXml += `
        <Rule>
          <Name>${rule.name}</Name>${symbolizerXml}
        </Rule>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>${styleName}</Name>
    <UserStyle>
      <Title>${styleName}</Title>
      <FeatureTypeStyle>${rulesXml}
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`
}

// Color picker component
function ColorPicker({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (color: string) => void
  label: string
}) {
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  return (
    <FormControl>
      <FormLabel fontSize="sm">{label}</FormLabel>
      <HStack>
        <Input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          w="50px"
          h="40px"
          p={1}
          borderRadius="md"
          cursor="pointer"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          size="sm"
          w="100px"
          fontFamily="mono"
          borderColor={borderColor}
        />
      </HStack>
    </FormControl>
  )
}

// Visual rule editor component
function RuleEditor({
  rule,
  onChange,
  onDelete,
}: {
  rule: StyleRule
  onChange: (rule: StyleRule) => void
  onDelete: () => void
}) {
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.600')

  const updateSymbolizer = (updates: Partial<StyleRule['symbolizer']>) => {
    onChange({
      ...rule,
      symbolizer: { ...rule.symbolizer, ...updates }
    })
  }

  return (
    <Box
      p={4}
      bg={bgColor}
      borderRadius="lg"
      border="1px solid"
      borderColor={borderColor}
    >
      <VStack spacing={4} align="stretch">
        <HStack justify="space-between">
          <FormControl maxW="200px">
            <FormLabel fontSize="sm">Rule Name</FormLabel>
            <Input
              size="sm"
              value={rule.name}
              onChange={(e) => onChange({ ...rule, name: e.target.value })}
            />
          </FormControl>
          <FormControl maxW="150px">
            <FormLabel fontSize="sm">Geometry Type</FormLabel>
            <Select
              size="sm"
              value={rule.symbolizer.type}
              onChange={(e) => updateSymbolizer({ type: e.target.value as 'polygon' | 'line' | 'point' })}
            >
              <option value="polygon">Polygon</option>
              <option value="line">Line</option>
              <option value="point">Point</option>
            </Select>
          </FormControl>
          <IconButton
            aria-label="Delete rule"
            icon={<FiMinus />}
            size="sm"
            colorScheme="red"
            variant="ghost"
            onClick={onDelete}
          />
        </HStack>

        <Divider />

        {/* Fill settings (for polygon and point) */}
        {(rule.symbolizer.type === 'polygon' || rule.symbolizer.type === 'point') && (
          <Box>
            <Text fontWeight="600" fontSize="sm" mb={2}>Fill</Text>
            <HStack spacing={4} wrap="wrap">
              <ColorPicker
                label="Color"
                value={rule.symbolizer.fill || '#3388ff'}
                onChange={(color) => updateSymbolizer({ fill: color })}
              />
              <FormControl maxW="150px">
                <FormLabel fontSize="sm">Opacity</FormLabel>
                <HStack>
                  <Slider
                    value={rule.symbolizer.fillOpacity ?? 1}
                    min={0}
                    max={1}
                    step={0.1}
                    onChange={(val) => updateSymbolizer({ fillOpacity: val })}
                  >
                    <SliderTrack>
                      <SliderFilledTrack bg="kartoza.500" />
                    </SliderTrack>
                    <SliderThumb />
                  </Slider>
                  <Text fontSize="sm" w="40px">{((rule.symbolizer.fillOpacity ?? 1) * 100).toFixed(0)}%</Text>
                </HStack>
              </FormControl>
            </HStack>
          </Box>
        )}

        {/* Stroke settings */}
        <Box>
          <Text fontWeight="600" fontSize="sm" mb={2}>Stroke</Text>
          <HStack spacing={4} wrap="wrap">
            <ColorPicker
              label="Color"
              value={rule.symbolizer.stroke || '#2266cc'}
              onChange={(color) => updateSymbolizer({ stroke: color })}
            />
            <FormControl maxW="100px">
              <FormLabel fontSize="sm">Width</FormLabel>
              <NumberInput
                size="sm"
                value={rule.symbolizer.strokeWidth || 1}
                min={0}
                max={20}
                step={0.5}
                onChange={(_, val) => updateSymbolizer({ strokeWidth: val })}
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </FormControl>
            {rule.symbolizer.type === 'line' && (
              <FormControl maxW="150px">
                <FormLabel fontSize="sm">Opacity</FormLabel>
                <HStack>
                  <Slider
                    value={rule.symbolizer.strokeOpacity ?? 1}
                    min={0}
                    max={1}
                    step={0.1}
                    onChange={(val) => updateSymbolizer({ strokeOpacity: val })}
                  >
                    <SliderTrack>
                      <SliderFilledTrack bg="kartoza.500" />
                    </SliderTrack>
                    <SliderThumb />
                  </Slider>
                  <Text fontSize="sm" w="40px">{((rule.symbolizer.strokeOpacity ?? 1) * 100).toFixed(0)}%</Text>
                </HStack>
              </FormControl>
            )}
          </HStack>
        </Box>

        {/* Point-specific settings */}
        {rule.symbolizer.type === 'point' && (
          <Box>
            <Text fontWeight="600" fontSize="sm" mb={2}>Point Symbol</Text>
            <HStack spacing={4}>
              <FormControl maxW="150px">
                <FormLabel fontSize="sm">Shape</FormLabel>
                <Select
                  size="sm"
                  value={rule.symbolizer.pointShape || 'circle'}
                  onChange={(e) => updateSymbolizer({ pointShape: e.target.value as 'circle' | 'square' | 'triangle' | 'star' | 'cross' })}
                >
                  <option value="circle">Circle</option>
                  <option value="square">Square</option>
                  <option value="triangle">Triangle</option>
                  <option value="star">Star</option>
                  <option value="cross">Cross</option>
                </Select>
              </FormControl>
              <FormControl maxW="100px">
                <FormLabel fontSize="sm">Size</FormLabel>
                <NumberInput
                  size="sm"
                  value={rule.symbolizer.pointSize || 8}
                  min={1}
                  max={50}
                  onChange={(_, val) => updateSymbolizer({ pointSize: val })}
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
              </FormControl>
            </HStack>
          </Box>
        )}

        {/* Preview swatch */}
        <Box>
          <Text fontWeight="600" fontSize="sm" mb={2}>Preview</Text>
          <Box
            w="100px"
            h="60px"
            borderRadius="md"
            border="1px solid"
            borderColor={borderColor}
            display="flex"
            alignItems="center"
            justifyContent="center"
            bg="gray.100"
          >
            {rule.symbolizer.type === 'polygon' && (
              <Box
                w="60px"
                h="40px"
                borderRadius="sm"
                bg={rule.symbolizer.fill}
                opacity={rule.symbolizer.fillOpacity}
                border={`${rule.symbolizer.strokeWidth}px solid ${rule.symbolizer.stroke}`}
              />
            )}
            {rule.symbolizer.type === 'line' && (
              <Box
                w="60px"
                h={`${Math.max(2, rule.symbolizer.strokeWidth || 2)}px`}
                bg={rule.symbolizer.stroke}
                opacity={rule.symbolizer.strokeOpacity}
              />
            )}
            {rule.symbolizer.type === 'point' && (
              <Box
                w={`${rule.symbolizer.pointSize || 8}px`}
                h={`${rule.symbolizer.pointSize || 8}px`}
                borderRadius={rule.symbolizer.pointShape === 'circle' ? '50%' : 'sm'}
                bg={rule.symbolizer.fill}
                opacity={rule.symbolizer.fillOpacity}
                border={`${rule.symbolizer.strokeWidth}px solid ${rule.symbolizer.stroke}`}
              />
            )}
          </Box>
        </Box>
      </VStack>
    </Box>
  )
}

export function StyleDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const toast = useToast()
  const queryClient = useQueryClient()

  const isOpen = activeDialog === 'style'
  const isEditMode = dialogData?.mode === 'edit'
  const connectionId = dialogData?.data?.connectionId as string
  const workspace = dialogData?.data?.workspace as string
  const styleName = dialogData?.data?.name as string
  const previewLayer = dialogData?.data?.previewLayer as string | undefined

  // State
  const [name, setName] = useState('')
  const [format, setFormat] = useState<'sld' | 'css'>('sld')
  const [content, setContent] = useState('')
  const [rules, setRules] = useState<StyleRule[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [hasChanges, setHasChanges] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const bgColor = useColorModeValue('gray.50', 'gray.900')
  const headerBg = useColorModeValue('linear-gradient(135deg, #3d9970 0%, #2d7a5a 100%)', 'linear-gradient(135deg, #2d7a5a 0%, #1d5a40 100%)')

  // Fetch style content when editing
  const { data: styleData, isLoading } = useQuery({
    queryKey: ['style', connectionId, workspace, styleName],
    queryFn: () => api.getStyleContent(connectionId, workspace, styleName),
    enabled: isOpen && isEditMode && !!styleName,
  })

  // Initialize form when dialog opens or data loads
  useEffect(() => {
    if (!isOpen) return

    if (isEditMode && styleData) {
      setName(styleData.name)
      setFormat(styleData.format as 'sld' | 'css')
      setContent(styleData.content)
      if (styleData.format === 'sld') {
        setRules(parseSLDRules(styleData.content))
      }
    } else if (!isEditMode) {
      // New style
      setName('')
      setFormat('sld')
      setContent(DEFAULT_SLD)
      setRules(parseSLDRules(DEFAULT_SLD))
    }
    setHasChanges(false)
    setValidationError(null)
  }, [isOpen, isEditMode, styleData])

  // Sync visual editor changes to code
  useEffect(() => {
    if (format === 'sld' && activeTab === 0 && rules.length > 0) {
      const newContent = generateSLD(name || 'NewStyle', rules)
      if (newContent !== content) {
        setContent(newContent)
        setHasChanges(true)
      }
    }
  }, [rules, name])

  // Validate SLD content
  const validateContent = useCallback(() => {
    if (format === 'sld') {
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(content, 'text/xml')
        const parseError = doc.querySelector('parsererror')
        if (parseError) {
          setValidationError('Invalid XML: ' + parseError.textContent?.slice(0, 100))
          return false
        }
        setValidationError(null)
        return true
      } catch (e) {
        setValidationError('Failed to parse SLD')
        return false
      }
    }
    setValidationError(null)
    return true
  }, [content, format])

  // Mutations
  const updateMutation = useMutation({
    mutationFn: () => api.updateStyleContent(connectionId, workspace, styleName, content, format),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['styles', connectionId, workspace] })
      queryClient.invalidateQueries({ queryKey: ['style', connectionId, workspace, styleName] })
      toast({ title: 'Style updated', status: 'success', duration: 3000 })
      setHasChanges(false)
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update style', description: error.message, status: 'error', duration: 5000 })
    },
  })

  const createMutation = useMutation({
    mutationFn: () => api.createStyle(connectionId, workspace, name, content, format),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['styles', connectionId, workspace] })
      toast({ title: 'Style created', status: 'success', duration: 3000 })
      closeDialog()
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create style', description: error.message, status: 'error', duration: 5000 })
    },
  })

  const handleSave = () => {
    if (!validateContent()) {
      toast({ title: 'Please fix validation errors', status: 'warning', duration: 3000 })
      return
    }

    if (!isEditMode && !name.trim()) {
      toast({ title: 'Style name is required', status: 'warning', duration: 3000 })
      return
    }

    if (isEditMode) {
      updateMutation.mutate()
    } else {
      createMutation.mutate()
    }
  }

  const handleCodeChange = (value: string) => {
    setContent(value)
    setHasChanges(true)
    if (format === 'sld') {
      setRules(parseSLDRules(value))
    }
  }

  const handleFormatChange = (newFormat: 'sld' | 'css') => {
    if (newFormat === format) return

    // Convert content or use default
    if (newFormat === 'sld') {
      setContent(DEFAULT_SLD)
      setRules(parseSLDRules(DEFAULT_SLD))
    } else {
      setContent(DEFAULT_CSS)
      setRules([])
    }
    setFormat(newFormat)
    setHasChanges(true)
  }

  const addRule = () => {
    setRules([...rules, {
      name: `Rule ${rules.length + 1}`,
      symbolizer: {
        type: 'polygon',
        fill: '#3388ff',
        fillOpacity: 0.6,
        stroke: '#2266cc',
        strokeWidth: 1,
      }
    }])
  }

  const updateRule = (index: number, rule: StyleRule) => {
    const newRules = [...rules]
    newRules[index] = rule
    setRules(newRules)
    setHasChanges(true)
  }

  const deleteRule = (index: number) => {
    if (rules.length <= 1) {
      toast({ title: 'Cannot delete the last rule', status: 'warning', duration: 3000 })
      return
    }
    setRules(rules.filter((_, i) => i !== index))
    setHasChanges(true)
  }

  // Generate preview URL
  const handlePreview = async () => {
    if (!previewLayer) {
      toast({ title: 'No preview layer specified', status: 'info', duration: 3000 })
      return
    }

    // Start a preview session with the style applied
    try {
      const { url } = await api.startPreview({
        connId: connectionId,
        workspace,
        layerName: previewLayer,
        storeName: '',
        storeType: 'datastore',
        layerType: 'vector',
      })
      setPreviewUrl(url)
    } catch (error) {
      toast({ title: 'Failed to start preview', status: 'error', duration: 3000 })
    }
  }

  const extensions = useMemo(() => {
    return format === 'sld' ? [xml()] : [css()]
  }, [format])

  const isLoading_ = isLoading || updateMutation.isPending || createMutation.isPending

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="6xl" scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent maxH="90vh" borderRadius="xl" overflow="hidden">
        {/* Gradient Header */}
        <Box
          bg={headerBg}
          color="white"
          px={6}
          py={4}
        >
          <Flex align="center" justify="space-between">
            <HStack spacing={3}>
              <Icon as={FiDroplet} boxSize={6} />
              <Box>
                <Text fontSize="lg" fontWeight="600">
                  {isEditMode ? 'Edit Style' : 'Create Style'}
                </Text>
                <Text fontSize="sm" opacity={0.9}>
                  {isEditMode ? `Editing ${styleName}` : 'Create a new map style'}
                </Text>
              </Box>
            </HStack>
            <HStack>
              {hasChanges && (
                <Badge colorScheme="yellow" variant="solid">
                  Unsaved Changes
                </Badge>
              )}
              <Badge colorScheme={format === 'sld' ? 'blue' : 'purple'} variant="solid">
                {format.toUpperCase()}
              </Badge>
            </HStack>
          </Flex>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody p={0} bg={bgColor}>
          {isLoading ? (
            <Flex h="400px" align="center" justify="center">
              <Spinner size="xl" color="kartoza.500" />
            </Flex>
          ) : (
            <Flex h="70vh">
              {/* Left panel - Style Properties */}
              <Box w="250px" borderRight="1px solid" borderColor="gray.200" p={4} overflowY="auto">
                <VStack spacing={4} align="stretch">
                  {!isEditMode && (
                    <FormControl isRequired>
                      <FormLabel>Style Name</FormLabel>
                      <Input
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          setHasChanges(true)
                        }}
                        placeholder="my-style"
                      />
                    </FormControl>
                  )}

                  <FormControl>
                    <FormLabel>Format</FormLabel>
                    <Select
                      value={format}
                      onChange={(e) => handleFormatChange(e.target.value as 'sld' | 'css')}
                    >
                      <option value="sld">SLD (Styled Layer Descriptor)</option>
                      <option value="css">CSS (GeoServer CSS)</option>
                    </Select>
                  </FormControl>

                  <Divider />

                  {format === 'sld' && (
                    <>
                      <Text fontWeight="600">Quick Actions</Text>
                      <Button
                        size="sm"
                        leftIcon={<Icon as={FiSquare} />}
                        variant="outline"
                        onClick={() => setRules([{
                          name: 'Polygon',
                          symbolizer: { type: 'polygon', fill: '#3388ff', fillOpacity: 0.6, stroke: '#2266cc', strokeWidth: 1 }
                        }])}
                      >
                        Polygon Style
                      </Button>
                      <Button
                        size="sm"
                        leftIcon={<Icon as={FiMinus} />}
                        variant="outline"
                        onClick={() => setRules([{
                          name: 'Line',
                          symbolizer: { type: 'line', stroke: '#3388ff', strokeWidth: 2, strokeOpacity: 1 }
                        }])}
                      >
                        Line Style
                      </Button>
                      <Button
                        size="sm"
                        leftIcon={<Icon as={FiCircle} />}
                        variant="outline"
                        onClick={() => setRules([{
                          name: 'Point',
                          symbolizer: { type: 'point', fill: '#3388ff', fillOpacity: 1, stroke: '#2266cc', strokeWidth: 1, pointShape: 'circle', pointSize: 8 }
                        }])}
                      >
                        Point Style
                      </Button>
                    </>
                  )}

                  {previewLayer && (
                    <>
                      <Divider />
                      <Text fontWeight="600">Preview</Text>
                      <Text fontSize="sm" color="gray.600">Layer: {previewLayer}</Text>
                      <Button
                        size="sm"
                        leftIcon={<Icon as={FiEye} />}
                        colorScheme="kartoza"
                        onClick={handlePreview}
                      >
                        Preview on Map
                      </Button>
                    </>
                  )}
                </VStack>
              </Box>

              {/* Main content area */}
              <Box flex="1" display="flex" flexDirection="column">
                <Tabs index={activeTab} onChange={setActiveTab} flex="1" display="flex" flexDirection="column">
                  <TabList px={4} pt={2}>
                    {format === 'sld' && (
                      <Tab>
                        <Icon as={FiDroplet} mr={2} />
                        Visual Editor
                      </Tab>
                    )}
                    <Tab>
                      <Icon as={FiCode} mr={2} />
                      Code Editor
                    </Tab>
                    {previewUrl && (
                      <Tab>
                        <Icon as={FiEye} mr={2} />
                        Map Preview
                      </Tab>
                    )}
                  </TabList>

                  <TabPanels flex="1" overflow="hidden">
                    {format === 'sld' && (
                      <TabPanel h="100%" overflowY="auto" p={4}>
                        <VStack spacing={4} align="stretch">
                          {validationError && (
                            <Alert status="warning" borderRadius="md">
                              <AlertIcon />
                              {validationError}
                            </Alert>
                          )}

                          {rules.map((rule, index) => (
                            <RuleEditor
                              key={index}
                              rule={rule}
                              onChange={(r) => updateRule(index, r)}
                              onDelete={() => deleteRule(index)}
                            />
                          ))}

                          <Button
                            leftIcon={<Icon as={FiDroplet} />}
                            onClick={addRule}
                            variant="outline"
                            colorScheme="kartoza"
                          >
                            Add Rule
                          </Button>
                        </VStack>
                      </TabPanel>
                    )}

                    <TabPanel h="100%" p={0}>
                      <Box h="100%" position="relative">
                        {validationError && (
                          <Alert status="warning" position="absolute" top={0} left={0} right={0} zIndex={1}>
                            <AlertIcon />
                            {validationError}
                          </Alert>
                        )}
                        <CodeMirror
                          value={content}
                          height="100%"
                          extensions={extensions}
                          onChange={handleCodeChange}
                          onBlur={validateContent}
                          theme="light"
                          style={{ height: '100%' }}
                        />
                      </Box>
                    </TabPanel>

                    {previewUrl && (
                      <TabPanel h="100%" p={0}>
                        <iframe
                          src={previewUrl}
                          style={{ width: '100%', height: '100%', border: 'none' }}
                          title="Style Preview"
                        />
                      </TabPanel>
                    )}
                  </TabPanels>
                </Tabs>
              </Box>
            </Flex>
          )}
        </ModalBody>

        <ModalFooter
          gap={3}
          borderTop="1px solid"
          borderTopColor="gray.200"
          bg="gray.50"
        >
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            colorScheme="kartoza"
            leftIcon={<Icon as={FiSave} />}
            onClick={handleSave}
            isLoading={isLoading_}
            isDisabled={!hasChanges && isEditMode}
          >
            {isEditMode ? 'Save Changes' : 'Create Style'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

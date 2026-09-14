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
  Divider,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Alert,
  AlertIcon,
  Spinner,
  Collapse,
  useDisclosure,
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
  FiGrid,
  FiChevronDown,
  FiChevronUp,
  FiImage,
} from 'react-icons/fi'
import { useUIStore } from '../../../stores/uiStore'
import * as api from '../../../api'

// Import from refactored modules
import type { ClassificationMethod, StyleRule } from './types'
import {
  DEFAULT_SLD,
  DEFAULT_CSS,
  COLOR_RAMPS,
  RASTER_COLOR_RAMPS,
  HILLSHADE_PRESETS,
} from './constants'
import { parseSLDRules, generateSLD } from './sld-utils'
import {
  calculateBreaks,
  interpolateColors,
  generateClassifiedSLD,
  generateRasterColorMapSLD,
  generateHillshadeSLD,
  generateHillshadeWithColorSLD,
  generateContrastEnhancementSLD,
} from './sld-generators'
import { RuleEditor } from './components/RuleEditor'

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

  // Classification wizard state
  const { isOpen: classifyPanelOpen, onToggle: toggleClassifyPanel } = useDisclosure()
  const [classifyAttribute, setClassifyAttribute] = useState('')
  const [classifyMethod, setClassifyMethod] = useState<ClassificationMethod>('equal-interval')
  const [classifyClasses, setClassifyClasses] = useState(5)
  const [classifyColorRamp, setClassifyColorRamp] = useState('blue-to-red')
  const [classifyGeomType, setClassifyGeomType] = useState<'polygon' | 'line' | 'point'>('polygon')
  const [classifySampleValues, setClassifySampleValues] = useState('')

  // Raster style wizard state
  const { isOpen: rasterPanelOpen, onToggle: toggleRasterPanel } = useDisclosure()
  const [rasterStyleType, setRasterStyleType] = useState<'colormap' | 'hillshade' | 'hillshade-color' | 'contrast'>('colormap')
  const [rasterColorRamp, setRasterColorRamp] = useState('rainbow')
  const [rasterMinValue, setRasterMinValue] = useState(0)
  const [rasterMaxValue, setRasterMaxValue] = useState(1000)
  const [rasterOpacity, setRasterOpacity] = useState(1)
  const [rasterColorMapType, setRasterColorMapType] = useState<'ramp' | 'intervals' | 'values'>('ramp')
  const [hillshadeAzimuth, setHillshadeAzimuth] = useState(315)
  const [hillshadeAltitude, setHillshadeAltitude] = useState(45)
  const [hillshadeZFactor, setHillshadeZFactor] = useState(1)
  const [contrastMethod, setContrastMethod] = useState<'normalize' | 'histogram' | 'none'>('normalize')
  const [gammaValue, setGammaValue] = useState(1.0)

  const bgColor = useColorModeValue('gray.50', 'gray.900')
  const headerBg = useColorModeValue('linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)', 'linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)')

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
  }, [rules, name, activeTab, content, format])

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

  // Generate classified style
  const handleGenerateClassifiedStyle = () => {
    // Parse sample values
    const values = classifySampleValues
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n))

    if (values.length < 2) {
      toast({
        title: 'Need more sample values',
        description: 'Please enter at least 2 numeric values separated by commas',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    // Calculate breaks
    const breaks = calculateBreaks(values, classifyClasses, classifyMethod)
    const colors = interpolateColors(COLOR_RAMPS[classifyColorRamp], classifyClasses)

    // Generate SLD
    const sld = generateClassifiedSLD(
      name || 'ClassifiedStyle',
      classifyAttribute,
      breaks,
      colors,
      classifyGeomType
    )

    setContent(sld)
    setFormat('sld')
    setRules(parseSLDRules(sld))
    setHasChanges(true)
    setActiveTab(1) // Switch to code editor to show result

    toast({
      title: 'Classified style generated',
      description: `Created ${classifyClasses} classes using ${classifyMethod.replace('-', ' ')}`,
      status: 'success',
      duration: 3000,
    })
  }

  // Generate raster style
  const handleGenerateRasterStyle = () => {
    const styleName_ = name || 'RasterStyle'
    const colorRamp = RASTER_COLOR_RAMPS[rasterColorRamp]?.colors || RASTER_COLOR_RAMPS['rainbow'].colors
    let sld: string

    switch (rasterStyleType) {
      case 'colormap':
        sld = generateRasterColorMapSLD(
          styleName_,
          colorRamp,
          rasterMinValue,
          rasterMaxValue,
          rasterColorMapType,
          rasterOpacity
        )
        break
      case 'hillshade':
        sld = generateHillshadeSLD(
          styleName_,
          hillshadeAzimuth,
          hillshadeAltitude,
          hillshadeZFactor,
          rasterOpacity
        )
        break
      case 'hillshade-color':
        sld = generateHillshadeWithColorSLD(
          styleName_,
          colorRamp,
          rasterMinValue,
          rasterMaxValue,
          hillshadeAzimuth,
          hillshadeAltitude,
          hillshadeZFactor,
          rasterOpacity
        )
        break
      case 'contrast':
        sld = generateContrastEnhancementSLD(
          styleName_,
          contrastMethod,
          gammaValue,
          rasterOpacity
        )
        break
      default:
        sld = generateRasterColorMapSLD(styleName_, colorRamp, rasterMinValue, rasterMaxValue, 'ramp', rasterOpacity)
    }

    setContent(sld)
    setFormat('sld')
    setRules([]) // Clear vector rules
    setHasChanges(true)
    setActiveTab(1) // Switch to code editor to show result

    toast({
      title: 'Raster style generated',
      description: `Created ${rasterStyleType === 'hillshade' ? 'hillshade' : rasterStyleType === 'hillshade-color' ? 'hillshade with colors' : rasterStyleType === 'contrast' ? 'contrast enhanced' : 'color map'} style`,
      status: 'success',
      duration: 3000,
    })
  }

  // Apply hillshade preset
  const applyHillshadePreset = (preset: typeof HILLSHADE_PRESETS[0]) => {
    setHillshadeAzimuth(preset.azimuth)
    setHillshadeAltitude(preset.altitude)
    setHillshadeZFactor(preset.zFactor)
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

                      <Divider />

                      <Text fontWeight="600">Classified Style</Text>
                      <Button
                        size="sm"
                        leftIcon={<Icon as={FiGrid} />}
                        rightIcon={<Icon as={classifyPanelOpen ? FiChevronUp : FiChevronDown} />}
                        variant="outline"
                        colorScheme="kartoza"
                        onClick={toggleClassifyPanel}
                      >
                        Choropleth Wizard
                      </Button>

                      <Collapse in={classifyPanelOpen} animateOpacity>
                        <VStack spacing={3} p={3} bg="gray.50" borderRadius="md" align="stretch">
                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Attribute</FormLabel>
                            <Input
                              size="sm"
                              value={classifyAttribute}
                              onChange={(e) => setClassifyAttribute(e.target.value)}
                              placeholder="population"
                            />
                          </FormControl>

                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Method</FormLabel>
                            <Select
                              size="sm"
                              value={classifyMethod}
                              onChange={(e) => setClassifyMethod(e.target.value as ClassificationMethod)}
                            >
                              <option value="equal-interval">Equal Interval</option>
                              <option value="quantile">Quantile</option>
                              <option value="jenks">Jenks Natural Breaks</option>
                              <option value="pretty">Pretty Breaks</option>
                            </Select>
                          </FormControl>

                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Classes: {classifyClasses}</FormLabel>
                            <Slider
                              value={classifyClasses}
                              onChange={(v) => setClassifyClasses(v)}
                              min={3}
                              max={10}
                              step={1}
                            >
                              <SliderTrack>
                                <SliderFilledTrack bg="kartoza.500" />
                              </SliderTrack>
                              <SliderThumb />
                            </Slider>
                          </FormControl>

                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Color Ramp</FormLabel>
                            <Select
                              size="sm"
                              value={classifyColorRamp}
                              onChange={(e) => setClassifyColorRamp(e.target.value)}
                            >
                              {Object.keys(COLOR_RAMPS).map((rampName) => (
                                <option key={rampName} value={rampName}>
                                  {rampName.replace(/-/g, ' ')}
                                </option>
                              ))}
                            </Select>
                            <HStack mt={1} spacing={1}>
                              {interpolateColors(COLOR_RAMPS[classifyColorRamp], classifyClasses).map((color, i) => (
                                <Box key={i} w="16px" h="12px" bg={color} borderRadius="sm" />
                              ))}
                            </HStack>
                          </FormControl>

                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Geometry Type</FormLabel>
                            <Select
                              size="sm"
                              value={classifyGeomType}
                              onChange={(e) => setClassifyGeomType(e.target.value as 'polygon' | 'line' | 'point')}
                            >
                              <option value="polygon">Polygon</option>
                              <option value="line">Line</option>
                              <option value="point">Point</option>
                            </Select>
                          </FormControl>

                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Sample Values (comma separated)</FormLabel>
                            <Input
                              size="sm"
                              value={classifySampleValues}
                              onChange={(e) => setClassifySampleValues(e.target.value)}
                              placeholder="10, 25, 50, 100, 200"
                            />
                          </FormControl>

                          <Button
                            size="sm"
                            colorScheme="kartoza"
                            onClick={handleGenerateClassifiedStyle}
                            isDisabled={!classifyAttribute || !classifySampleValues}
                          >
                            Generate Style
                          </Button>
                        </VStack>
                      </Collapse>

                      <Divider />

                      <Text fontWeight="600">Raster Style</Text>
                      <Button
                        size="sm"
                        leftIcon={<Icon as={FiImage} />}
                        rightIcon={<Icon as={rasterPanelOpen ? FiChevronUp : FiChevronDown} />}
                        variant="outline"
                        colorScheme="purple"
                        onClick={toggleRasterPanel}
                      >
                        Raster Wizard
                      </Button>

                      <Collapse in={rasterPanelOpen} animateOpacity>
                        <VStack spacing={3} p={3} bg="purple.50" borderRadius="md" align="stretch">
                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Style Type</FormLabel>
                            <Select
                              size="sm"
                              value={rasterStyleType}
                              onChange={(e) => setRasterStyleType(e.target.value as 'colormap' | 'hillshade' | 'hillshade-color' | 'contrast')}
                            >
                              <option value="colormap">Color Map (Graduated)</option>
                              <option value="hillshade">Hillshade Only</option>
                              <option value="hillshade-color">Hillshade + Colors</option>
                              <option value="contrast">Contrast Enhancement</option>
                            </Select>
                          </FormControl>

                          {(rasterStyleType === 'colormap' || rasterStyleType === 'hillshade-color') && (
                            <>
                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Color Ramp</FormLabel>
                                <Select
                                  size="sm"
                                  value={rasterColorRamp}
                                  onChange={(e) => setRasterColorRamp(e.target.value)}
                                >
                                  {Object.entries(RASTER_COLOR_RAMPS).map(([key, ramp]) => (
                                    <option key={key} value={key}>{ramp.name}</option>
                                  ))}
                                </Select>
                                <HStack mt={1} spacing={0}>
                                  {RASTER_COLOR_RAMPS[rasterColorRamp]?.colors.map((color, i) => (
                                    <Box key={i} flex="1" h="8px" bg={color} borderRadius={i === 0 ? 'sm 0 0 sm' : i === RASTER_COLOR_RAMPS[rasterColorRamp].colors.length - 1 ? '0 sm sm 0' : '0'} />
                                  ))}
                                </HStack>
                                <Text fontSize="xs" color="gray.500" mt={1}>
                                  {RASTER_COLOR_RAMPS[rasterColorRamp]?.description}
                                </Text>
                              </FormControl>

                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Min Value</FormLabel>
                                <Input
                                  size="sm"
                                  type="number"
                                  value={rasterMinValue}
                                  onChange={(e) => setRasterMinValue(parseFloat(e.target.value) || 0)}
                                />
                              </FormControl>

                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Max Value</FormLabel>
                                <Input
                                  size="sm"
                                  type="number"
                                  value={rasterMaxValue}
                                  onChange={(e) => setRasterMaxValue(parseFloat(e.target.value) || 1000)}
                                />
                              </FormControl>

                              {rasterStyleType === 'colormap' && (
                                <FormControl size="sm">
                                  <FormLabel fontSize="xs">Color Map Type</FormLabel>
                                  <Select
                                    size="sm"
                                    value={rasterColorMapType}
                                    onChange={(e) => setRasterColorMapType(e.target.value as 'ramp' | 'intervals' | 'values')}
                                  >
                                    <option value="ramp">Ramp (Smooth gradient)</option>
                                    <option value="intervals">Intervals (Discrete)</option>
                                    <option value="values">Values (Exact match)</option>
                                  </Select>
                                </FormControl>
                              )}
                            </>
                          )}

                          {(rasterStyleType === 'hillshade' || rasterStyleType === 'hillshade-color') && (
                            <>
                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Hillshade Preset</FormLabel>
                                <Select
                                  size="sm"
                                  placeholder="Select preset..."
                                  onChange={(e) => {
                                    const preset = HILLSHADE_PRESETS.find(p => p.name === e.target.value)
                                    if (preset) applyHillshadePreset(preset)
                                  }}
                                >
                                  {HILLSHADE_PRESETS.map((preset) => (
                                    <option key={preset.name} value={preset.name}>{preset.name}</option>
                                  ))}
                                </Select>
                              </FormControl>

                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Sun Azimuth: {hillshadeAzimuth}°</FormLabel>
                                <Slider
                                  value={hillshadeAzimuth}
                                  onChange={(v) => setHillshadeAzimuth(v)}
                                  min={0}
                                  max={360}
                                  step={15}
                                >
                                  <SliderTrack>
                                    <SliderFilledTrack bg="purple.500" />
                                  </SliderTrack>
                                  <SliderThumb />
                                </Slider>
                              </FormControl>

                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Sun Altitude: {hillshadeAltitude}°</FormLabel>
                                <Slider
                                  value={hillshadeAltitude}
                                  onChange={(v) => setHillshadeAltitude(v)}
                                  min={0}
                                  max={90}
                                  step={5}
                                >
                                  <SliderTrack>
                                    <SliderFilledTrack bg="purple.500" />
                                  </SliderTrack>
                                  <SliderThumb />
                                </Slider>
                              </FormControl>

                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Z Factor: {hillshadeZFactor}</FormLabel>
                                <Slider
                                  value={hillshadeZFactor}
                                  onChange={(v) => setHillshadeZFactor(v)}
                                  min={0.1}
                                  max={5}
                                  step={0.1}
                                >
                                  <SliderTrack>
                                    <SliderFilledTrack bg="purple.500" />
                                  </SliderTrack>
                                  <SliderThumb />
                                </Slider>
                              </FormControl>
                            </>
                          )}

                          {rasterStyleType === 'contrast' && (
                            <>
                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Enhancement Method</FormLabel>
                                <Select
                                  size="sm"
                                  value={contrastMethod}
                                  onChange={(e) => setContrastMethod(e.target.value as 'normalize' | 'histogram' | 'none')}
                                >
                                  <option value="normalize">Normalize (Stretch to min/max)</option>
                                  <option value="histogram">Histogram Equalization</option>
                                  <option value="none">None</option>
                                </Select>
                              </FormControl>

                              <FormControl size="sm">
                                <FormLabel fontSize="xs">Gamma: {gammaValue.toFixed(1)}</FormLabel>
                                <Slider
                                  value={gammaValue}
                                  onChange={(v) => setGammaValue(v)}
                                  min={0.1}
                                  max={3}
                                  step={0.1}
                                >
                                  <SliderTrack>
                                    <SliderFilledTrack bg="purple.500" />
                                  </SliderTrack>
                                  <SliderThumb />
                                </Slider>
                              </FormControl>
                            </>
                          )}

                          <FormControl size="sm">
                            <FormLabel fontSize="xs">Opacity: {(rasterOpacity * 100).toFixed(0)}%</FormLabel>
                            <Slider
                              value={rasterOpacity}
                              onChange={(v) => setRasterOpacity(v)}
                              min={0}
                              max={1}
                              step={0.05}
                            >
                              <SliderTrack>
                                <SliderFilledTrack bg="purple.500" />
                              </SliderTrack>
                              <SliderThumb />
                            </Slider>
                          </FormControl>

                          <Button
                            size="sm"
                            colorScheme="purple"
                            onClick={handleGenerateRasterStyle}
                          >
                            Generate Raster Style
                          </Button>
                        </VStack>
                      </Collapse>
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

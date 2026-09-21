import { useRef } from 'react'
import {
  Box,
  HStack,
  VStack,
  Text,
  IconButton,
  Spinner,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Select,
  Tooltip,
  chakra,
} from '@chakra-ui/react'
import { motion, useDragControls } from 'framer-motion'
import { FiX, FiAlertTriangle, FiMaximize2, FiMove } from 'react-icons/fi'

import type { LayerSearchOption, MapLayerState } from '../types'
import LayerSearch from './LayerSearch'
import './styles.css'

const LEGEND_GRADIENT = 'linear(to-r, #eaf6ff, #4a9cb8, #E8A331, #c0392b)'

const MotionBox = chakra(motion.div)

interface LayersPanelProps {
  layers: MapLayerState[]
  availableLayers: LayerSearchOption[]
  isLoadingSources: boolean
  onAddLayer: (option: LayerSearchOption) => void
  onZoomToExtent: (bounds: [number, number, number, number]) => void
  onOpacityChange: (layerId: string, value: number) => void
  onRemoveLayer: (layerId: string) => void
  onStyleModeChange: (layerId: string, mode: 'default' | 'custom') => void
  /** Element the panel can't be dragged outside of (defaults to the viewport). */
  dragConstraintsRef?: React.RefObject<HTMLElement>
}

export default function LayersPanel({
  layers,
  availableLayers,
  isLoadingSources,
  onAddLayer,
  onZoomToExtent,
  onOpacityChange,
  onRemoveLayer,
  onStyleModeChange,
  dragConstraintsRef,
}: LayersPanelProps) {
  const dragControls = useDragControls()
  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <MotionBox
      ref={panelRef}
      position="absolute"
      top={4}
      right="64px"
      bg="white"
      rounded="xl"
      shadow="lg"
      w="300px"
      maxH="75vh"
      display="flex"
      flexDirection="column"
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={dragConstraintsRef}
      style={{ touchAction: 'none' }}
    >
      <Box p={4} flexShrink={0}>
        <HStack
          mb={3}
          justify="space-between"
          cursor="grab"
          userSelect="none"
          onPointerDown={(e) => dragControls.start(e)}
          sx={{ '&:active': { cursor: 'grabbing' } }}
        >
          <HStack spacing={2}>
            <Box color="gray.400">
              <FiMove size={12} />
            </Box>
            <Text fontWeight="600" color="gray.800">
              Layers
            </Text>
          </HStack>
          {isLoadingSources && <Spinner size="xs" color="gray.400" />}
        </HStack>

        <LayerSearch options={availableLayers} onSelect={onAddLayer} isDisabled={isLoadingSources} />

        {layers.length === 0 && (
          <Text fontSize="sm" color="gray.500">
            {isLoadingSources ? 'Looking for layers across your S3 connections…' : 'Search above to add a layer to the map.'}
          </Text>
        )}
      </Box>

      <VStack spacing={4} align="stretch" overflowY="auto" px={4} pb={4} flex={1} minH={0}>
        {layers.map((layer) => (
          <Box key={layer.id}>
            <HStack justify="space-between" mb={1}>
              <HStack spacing={2}>
                <Box w="10px" h="10px" borderRadius="full" bg={layer.color} />
                <Text fontSize="sm" fontWeight="500" color="gray.700" noOfLines={1}>
                  {layer.name}
                </Text>
                {layer.status === 'loading' && <Spinner size="xs" />}
                {layer.status === 'error' && (
                  <Tooltip label="This source could not be read">
                    <Box color="orange.500">
                      <FiAlertTriangle size={12} />
                    </Box>
                  </Tooltip>
                )}
              </HStack>
              <HStack spacing={1}>
                <Tooltip label="Zoom to extent">
                  <IconButton
                    aria-label={`Zoom to extent of ${layer.name}`}
                    icon={<FiMaximize2 size={12} />}
                    size="xs"
                    variant="ghost"
                    isDisabled={!layer.bounds}
                    onClick={() => layer.bounds && onZoomToExtent(layer.bounds)}
                  />
                </Tooltip>
                <IconButton
                  aria-label={`Remove ${layer.name}`}
                  icon={<FiX size={14} />}
                  size="xs"
                  variant="ghost"
                  onClick={() => onRemoveLayer(layer.id)}
                />
              </HStack>
            </HStack>
            {layer.hasCustomStyle && (
              <Select
                size="xs"
                mb={2}
                value={layer.styleMode ?? 'custom'}
                onChange={(e) => onStyleModeChange(layer.id, e.target.value as 'default' | 'custom')}
              >
                <option value="custom">Custom style</option>
                <option value="default">Default style</option>
              </Select>
            )}
            <Box h="8px" borderRadius="full" bgGradient={LEGEND_GRADIENT} mb={1} />
            <HStack justify="space-between" mb={1}>
              <Text fontSize="xs" color="gray.400">
                0%
              </Text>
              <Text fontSize="xs" color="gray.400">
                100%
              </Text>
            </HStack>
            <Slider
              value={layer.opacity}
              min={0}
              max={100}
              isDisabled={layer.status !== 'ready'}
              onChange={(v) => onOpacityChange(layer.id, v)}
              colorScheme="orange"
            >
              <SliderTrack>
                <SliderFilledTrack />
              </SliderTrack>
              <SliderThumb boxSize={4} bg="accent.400" />
            </Slider>
          </Box>
        ))}
      </VStack>
    </MotionBox>
  )
}

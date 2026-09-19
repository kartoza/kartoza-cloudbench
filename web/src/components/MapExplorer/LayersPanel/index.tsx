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
  Tooltip,
} from '@chakra-ui/react'
import { FiX, FiAlertTriangle, FiMaximize2 } from 'react-icons/fi'

import type { MapLayerState } from '../types'
import './styles.css'

const LEGEND_GRADIENT = 'linear(to-r, #eaf6ff, #4a9cb8, #E8A331, #c0392b)'

interface LayersPanelProps {
  layers: MapLayerState[]
  isLoadingSources: boolean
  onZoomToExtent: (bounds: [number, number, number, number]) => void
  onOpacityChange: (layerId: string, value: number) => void
  onRemoveLayer: (layerId: string) => void
}

export default function LayersPanel({
  layers,
  isLoadingSources,
  onZoomToExtent,
  onOpacityChange,
  onRemoveLayer,
}: LayersPanelProps) {
  return (
    <Box
      position="absolute"
      top={4}
      right="64px"
      bg="white"
      rounded="xl"
      shadow="lg"
      p={4}
      w="300px"
      maxH="75vh"
      overflowY="auto"
    >
      <HStack mb={3} justify="space-between">
        <Text fontWeight="600" color="gray.800">
          Layers
        </Text>
        {isLoadingSources && <Spinner size="xs" color="gray.400" />}
      </HStack>

      {layers.length === 0 && !isLoadingSources && (
        <Text fontSize="sm" color="gray.500">
          No PMTiles or COG layers found in this bucket.
        </Text>
      )}

      <VStack spacing={4} align="stretch">
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
    </Box>
  )
}

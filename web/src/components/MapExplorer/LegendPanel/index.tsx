import { Box, HStack, VStack, Text, Spinner, chakra } from '@chakra-ui/react'
import { motion, useDragControls } from 'framer-motion'
import { FiMove } from 'react-icons/fi'

import type { LegendItem, MapLayerState } from '../types'

const MotionBox = chakra(motion.div)

interface LegendPanelProps {
  layers: MapLayerState[]
  /** Element the panel can't be dragged outside of (defaults to the viewport). */
  dragConstraintsRef?: React.RefObject<HTMLElement>
}

function LegendSwatch({ item, opacity }: { item: LegendItem; opacity: number }) {
  if (item.kind === 'line') {
    return <Box w="16px" h="3px" borderRadius="full" bg={item.color} opacity={opacity} flexShrink={0} />
  }
  if (item.kind === 'circle') {
    return <Box w="10px" h="10px" mx="3px" borderRadius="full" bg={item.color} opacity={opacity} flexShrink={0} />
  }
  return (
    <Box
      w="16px"
      h="12px"
      borderRadius="sm"
      bg={item.color}
      opacity={opacity}
      border="1px solid"
      borderColor="blackAlpha.300"
      flexShrink={0}
    />
  )
}

function legendItemsFor(layer: MapLayerState): LegendItem[] {
  if (layer.styleMode !== 'default' && layer.customLegend && layer.customLegend.length > 0) return layer.customLegend
  return [{ label: layer.sourceLayer ?? layer.name, color: layer.color, kind: 'fill' }]
}

export default function LegendPanel({ layers, dragConstraintsRef }: LegendPanelProps) {
  const dragControls = useDragControls()

  if (layers.length === 0) return null

  return (
    <MotionBox
      position="absolute"
      bottom={4}
      left={4}
      bg="white"
      rounded="xl"
      shadow="lg"
      w="240px"
      maxH="45vh"
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
      <HStack
        px={4}
        pt={3}
        pb={2}
        spacing={2}
        flexShrink={0}
        cursor="grab"
        userSelect="none"
        onPointerDown={(e) => dragControls.start(e)}
        sx={{ '&:active': { cursor: 'grabbing' } }}
      >
        <Box color="gray.400">
          <FiMove size={12} />
        </Box>
        <Text fontWeight="600" color="gray.800">
          Legend
        </Text>
      </HStack>

      <VStack spacing={3} align="stretch" overflowY="auto" px={4} pb={3} flex={1} minH={0}>
        {layers.map((layer) => (
          <Box key={layer.id}>
            <HStack spacing={2} mb={1}>
              <Text fontSize="xs" fontWeight="600" color="gray.700" noOfLines={1}>
                {layer.name}
              </Text>
              {layer.status === 'loading' && <Spinner size="xs" />}
            </HStack>
            {layer.status === 'error' ? (
              <Text fontSize="xs" color="gray.400">
                Source could not be read
              </Text>
            ) : layer.status === 'ready' && !layer.isVector ? (
              <Text fontSize="xs" color="gray.400">
                Raster layer — no legend available
              </Text>
            ) : layer.status === 'ready' ? (
              <VStack spacing={1} align="stretch">
                {legendItemsFor(layer).map((item, i) => (
                  <HStack key={`${item.label}-${i}`} spacing={2}>
                    <LegendSwatch item={item} opacity={layer.opacity / 100} />
                    <Text fontSize="xs" color="gray.600" noOfLines={1}>
                      {item.label}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            ) : null}
          </Box>
        ))}
      </VStack>
    </MotionBox>
  )
}

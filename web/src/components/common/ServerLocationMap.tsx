import { Box, VStack, HStack, Icon, Text, useColorModeValue } from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import { FiMapPin, FiServer } from 'react-icons/fi'

const pulse = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(2);
    opacity: 0.5;
  }
  100% {
    transform: scale(3);
    opacity: 0;
  }
`

// Simplified world map paths (continent outlines)
const WORLD_MAP_PATH = `
  M 115 95 Q 120 80 140 75 Q 160 70 180 78 Q 200 85 210 95 Q 220 105 215 120
  Q 210 135 195 145 Q 180 155 160 160 Q 140 165 125 155 Q 110 145 105 130
  Q 100 115 115 95 Z
  M 125 170 Q 135 165 145 170 Q 155 175 160 190 Q 165 205 158 225
  Q 150 245 140 255 Q 130 265 120 260 Q 110 255 108 240 Q 105 225 110 205
  Q 115 185 125 170 Z
  M 440 70 Q 460 65 480 72 Q 500 80 510 95 Q 520 110 515 125
  Q 510 140 495 145 Q 480 150 460 145 Q 440 140 430 125 Q 420 110 425 90 Q 430 75 440 70 Z
  M 455 155 Q 475 150 495 158 Q 515 165 525 185 Q 535 205 530 230
  Q 525 255 510 270 Q 495 285 475 282 Q 455 280 445 265 Q 435 250 438 225
  Q 440 200 445 180 Q 450 160 455 155 Z
  M 550 60 Q 590 50 640 55 Q 690 60 730 80 Q 770 100 790 130
  Q 810 160 800 195 Q 790 230 760 250 Q 730 270 690 275 Q 650 280 610 270
  Q 570 260 545 235 Q 520 210 520 175 Q 520 140 530 110 Q 540 80 550 60 Z
  M 770 280 Q 790 275 810 285 Q 830 295 835 315 Q 840 335 830 350
  Q 820 365 800 368 Q 780 370 765 360 Q 750 350 752 330 Q 755 310 760 295 Q 765 285 770 280 Z
`

// Get location description from hostname
function getLocationDescription(host: string): string {
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return 'Local development server on this machine'
  }
  if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
    return 'Server on local network (private IP address)'
  }
  if (host.includes('kartoza.com')) {
    return 'Kartoza cloud infrastructure, Cape Town, South Africa'
  }
  if (host.includes('digitalocean.com') || host.includes('.do.')) {
    return 'DigitalOcean cloud infrastructure'
  }
  if (host.includes('aws.') || host.includes('amazonaws.com')) {
    return 'Amazon Web Services (AWS) cloud'
  }
  if (host.includes('azure.') || host.includes('microsoft.com')) {
    return 'Microsoft Azure cloud'
  }
  if (host.includes('gcp.') || host.includes('google')) {
    return 'Google Cloud Platform'
  }
  const parts = host.split('.')
  if (parts.length >= 2) {
    return `Remote server at ${host}`
  }
  return `Server: ${host}`
}

// Get approximate marker position based on hostname
function getMarkerPosition(host: string): { x: string; y: string } {
  if (!host || host === 'localhost' || host === '127.0.0.1' ||
      host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
    return { x: '48%', y: '35%' }
  }
  if (host.includes('kartoza.com')) {
    return { x: '53%', y: '72%' }
  }
  return { x: '50%', y: '45%' }
}

interface ServerLocationMapProps {
  host: string
}

export default function ServerLocationMap({ host }: ServerLocationMapProps) {
  const mapBg = useColorModeValue('blue.50', 'blue.900')
  const landColor = useColorModeValue('#D1D1D1', '#676869')
  const dotColor = useColorModeValue('red.500', 'red.400')
  const pulseColor = useColorModeValue('red.300', 'red.600')
  const textBg = useColorModeValue('gray.100', 'gray.700')
  const textColor = useColorModeValue('gray.700', 'gray.200')

  const markerPos = getMarkerPosition(host)
  const locationDesc = getLocationDescription(host)

  return (
    <VStack spacing={3} align="stretch">
      <Box
        position="relative"
        bg={mapBg}
        borderRadius="xl"
        overflow="hidden"
        h="180px"
        w="100%"
      >
        <svg
          viewBox="0 0 900 400"
          style={{ width: '100%', height: '100%' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <path
            d={WORLD_MAP_PATH}
            fill={landColor}
            stroke={landColor}
            strokeWidth="2"
            opacity="0.6"
          />
        </svg>

        <Box
          position="absolute"
          left={markerPos.x}
          top={markerPos.y}
          transform="translate(-50%, -50%)"
        >
          <Box
            position="absolute"
            w="24px"
            h="24px"
            borderRadius="full"
            bg={pulseColor}
            animation={`${pulse} 2s ease-out infinite`}
            transform="translate(-50%, -50%)"
            left="50%"
            top="50%"
          />
          <Box
            position="absolute"
            w="24px"
            h="24px"
            borderRadius="full"
            bg={pulseColor}
            animation={`${pulse} 2s ease-out infinite 0.6s`}
            transform="translate(-50%, -50%)"
            left="50%"
            top="50%"
          />
          <Box
            w="14px"
            h="14px"
            borderRadius="full"
            bg={dotColor}
            shadow="lg"
            position="relative"
            zIndex={1}
            border="2px solid white"
          />
        </Box>

        <Box
          position="absolute"
          bottom={3}
          left={3}
          bg="blackAlpha.700"
          px={3}
          py={1.5}
          borderRadius="lg"
        >
          <HStack spacing={2}>
            <Icon as={FiMapPin} color="red.300" boxSize={4} />
            <Text fontSize="sm" color="white" fontWeight="semibold">
              {host || 'localhost'}
            </Text>
          </HStack>
        </Box>
      </Box>

      <Box
        bg={textBg}
        px={4}
        py={2}
        borderRadius="lg"
      >
        <HStack spacing={2}>
          <Icon as={FiServer} color="blue.500" boxSize={4} />
          <Text fontSize="sm" color={textColor}>
            {locationDesc}
          </Text>
        </HStack>
      </Box>
    </VStack>
  )
}

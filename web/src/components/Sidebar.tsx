import { Box, Heading, useColorModeValue } from '@chakra-ui/react'
import ConnectionTree from './ConnectionTree'

export default function Sidebar() {
  const headerBg = useColorModeValue('gray.100', 'gray.700')

  return (
    <Box h="100%">
      <Box bg={headerBg} px={3} py={2}>
        <Heading size="sm" color="gray.700">
          GeoServer Explorer
        </Heading>
      </Box>
      <Box p={2}>
        <ConnectionTree />
      </Box>
    </Box>
  )
}

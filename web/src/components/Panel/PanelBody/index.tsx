import { ReactNode } from 'react'
import { Box, Flex } from '@chakra-ui/react'

import './styles.css'

interface PanelBodyProps {
  children: ReactNode
}

export function PanelBody({ children }: PanelBodyProps) {
  return (
    <Box
      flexGrow={1}
      p={4}
      overflowY="auto">
      <Flex
        gap={4}
        flexDir="column"
      >
        {children}
      </Flex>
    </Box>
  )
}
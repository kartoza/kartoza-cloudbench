import { ReactNode } from 'react'
import { Flex } from '@chakra-ui/react'

import './styles.css'

interface PanelHeaderProps {
  children: ReactNode
}

export function Panel({ children }: PanelHeaderProps) {
  return (
    <Flex h="100%" direction="column">
      {children}
    </Flex>
  )
}
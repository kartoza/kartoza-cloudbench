import { ReactNode } from 'react'
import { Flex } from '@chakra-ui/react'

import './styles.css'

interface PanelHeaderProps {
  children: ReactNode
}

export function PanelHeader({ children }: PanelHeaderProps) {
  return (
    <Flex
      p={4}
      className="panel-header"
    >
      {children}
    </Flex>
  )
}
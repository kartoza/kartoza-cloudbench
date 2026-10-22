import type { ReactNode } from 'react'
import { Box } from '@chakra-ui/react'
import { TREE_INDENT } from './utils'

// Wraps a node's children, shifting them one fixed step right of the parent.
// Depth comes from nesting these, so rows never compute their own indent.
export function TreeChildren({ children }: { children: ReactNode }) {
  return <Box ml={TREE_INDENT}>{children}</Box>
}

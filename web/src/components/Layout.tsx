import { Box, Flex, useColorModeValue } from '@chakra-ui/react'
import { ReactNode, useCallback, useRef, useState } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import StatusBar from './StatusBar'
import { useUIStore } from '../stores/uiStore'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const sidebarWidth = useUIStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUIStore((state) => state.setSidebarWidth)
  const bgColor = useColorModeValue('gray.50', 'gray.900')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const resizeHandleColor = useColorModeValue('gray.300', 'gray.600')
  const resizeHandleHoverColor = useColorModeValue('kartoza.400', 'kartoza.500')

  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)

    const handleMouseMove = (e: MouseEvent) => {
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect()
        const newWidth = e.clientX - containerRect.left
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [setSidebarWidth])

  return (
    <Flex direction="column" h="100vh" bg={bgColor}>
      <Header />
      <Flex flex="1" overflow="hidden" ref={containerRef}>
        <Box
          w={`${sidebarWidth}px`}
          borderRight="1px"
          borderColor={borderColor}
          overflow="auto"
          flexShrink={0}
          position="relative"
        >
          <Sidebar />
        </Box>
        {/* Resize Handle */}
        <Box
          w="6px"
          cursor="col-resize"
          bg={isResizing ? resizeHandleHoverColor : 'transparent'}
          _hover={{ bg: resizeHandleHoverColor }}
          transition="background 0.15s"
          flexShrink={0}
          position="relative"
          onMouseDown={handleMouseDown}
          ml="-3px"
          zIndex={10}
        >
          {/* Visual indicator line */}
          <Box
            position="absolute"
            left="50%"
            top="50%"
            transform="translate(-50%, -50%)"
            h="40px"
            w="4px"
            borderRadius="full"
            bg={isResizing ? 'white' : resizeHandleColor}
            opacity={isResizing ? 1 : 0}
            _groupHover={{ opacity: 0.8 }}
            transition="opacity 0.15s"
            sx={{
              '[data-resize-handle]:hover &': {
                opacity: 0.8,
              },
            }}
          />
        </Box>
        <Box
          flex="1"
          overflow="auto"
          p={4}
          display="flex"
          flexDirection="column"
        >
          {children}
        </Box>
      </Flex>
      <StatusBar />
    </Flex>
  )
}

import { Box, Tooltip } from '@chakra-ui/react'

interface OnlineStatusIndicatorProps {
  isOnline: boolean | null
}

export function OnlineStatusIndicator({ isOnline }: OnlineStatusIndicatorProps) {
  const color = isOnline == null ? 'gray.400' : isOnline ? 'green.400' : 'red.400'
  const label = isOnline == null ? 'Checking' : isOnline ? 'Online' : 'Offline'

  return (
    <Tooltip label={label} fontSize="xs" placement="top">
      <Box
        w={2}
        h={2}
        borderRadius="full"
        bg={color}
        flexShrink={0}
        mr={1}
        transition="background 0.3s ease"
      />
    </Tooltip>
  )
}
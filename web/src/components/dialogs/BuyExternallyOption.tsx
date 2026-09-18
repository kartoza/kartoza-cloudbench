import { Button, Divider, HStack, Text, useToast } from '@chakra-ui/react'
import { FiShoppingCart } from 'react-icons/fi'
import { openWindowWithCallback } from '../../utils/openWindowWithCallback'

interface BuyExternallyOptionProps {
  url: string | null
  label: string
  onSuccess: () => void
}

/**
 * "Buy in GeoHosting" button + "or" divider shown above a create-connection
 * form when a VITE_CREATE_*_URL override is configured (see
 * apps/core/views.py FrontendConfigView / web/src/config/env.ts). Opens the
 * external checkout in a popup instead of the manual form below it. Renders
 * nothing when no URL is configured, so callers don't need to guard on it.
 */
export function BuyExternallyOption({ url, label, onSuccess }: BuyExternallyOptionProps) {
  const toast = useToast()

  if (!url) return null

  const handleClick = () => {
    openWindowWithCallback(url, onSuccess, toast)
  }

  return (
    <>
      <Button
        w="100%"
        size="lg"
        colorScheme="purple"
        leftIcon={<FiShoppingCart />}
        borderRadius="lg"
        onClick={handleClick}
      >
        {label}
      </Button>
      <HStack w="100%" spacing={3}>
        <Divider />
        <Text fontSize="xs" color="gray.500" flexShrink={0}>
          or
        </Text>
        <Divider />
      </HStack>
    </>
  )
}

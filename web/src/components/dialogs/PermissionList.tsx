import { HStack, Icon, Text, VStack } from '@chakra-ui/react'
import { FiAlertTriangle, FiCheck, FiX } from 'react-icons/fi'
import type { ConnectionPermission } from '../../types'

// What a connection test found its credentials may do (apps/core/permissions.py):
// each permission CloudBench needs, and what fails without it.
export default function PermissionList({ permissions }: { permissions?: ConnectionPermission[] }) {
  if (!permissions?.length) return null
  return (
    <VStack align="stretch" spacing={1} mt={2} aria-label="Permissions">
      {permissions.map((permission) => {
        const icon = permission.allowed ? FiCheck : permission.required ? FiX : FiAlertTriangle
        const color = permission.allowed ? 'green.500' : permission.required ? 'red.500' : 'orange.500'
        return (
          <HStack key={permission.name} spacing={2} align="start">
            <Icon as={icon} color={color} mt="3px" flexShrink={0} />
            <Text fontSize="xs">
              <Text as="span" fontWeight="600">{permission.name}</Text>
              {permission.allowed
                ? ` — for ${permission.needed_for}`
                : ` — not allowed: ${permission.needed_for} won't work${permission.required ? '' : ' (optional)'}`}
            </Text>
          </HStack>
        )
      })}
    </VStack>
  )
}

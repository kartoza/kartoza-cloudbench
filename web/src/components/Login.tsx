import { useState, FormEvent } from 'react'
import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Text,
  useColorModeValue,
} from '@chakra-ui/react'
import { getApiBase } from '../config/env'

interface LoginProps {
  onLogin: () => void
}

/**
 * Standalone login screen — only reached when there's no token in
 * localStorage yet. GeoHosting's iframe handoff (see api/ssoBootstrap.ts)
 * sets the token before this ever renders, so this is specifically the
 * "using CloudBench on its own, no GeoHosting" entry point. Trades
 * username/password for a DRF auth token via /api/auth/login/ — same
 * `Authorization: Token <value>` shape common.ts already sends on every
 * request, so nothing else in the app needs to know how the token
 * was obtained.
 */
export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const bgColor = useColorModeValue('gray.50', 'gray.900')
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(`${getApiBase()}/auth/login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) {
        throw new Error('Invalid username or password')
      }
      const data = await response.json()
      localStorage.setItem('token', data.token)
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Flex minH="100vh" align="center" justify="center" bg={bgColor}>
      <Box
        as="form"
        onSubmit={handleSubmit}
        bg={cardBg}
        borderWidth="1px"
        borderColor={borderColor}
        borderRadius="lg"
        boxShadow="sm"
        p={8}
        w="full"
        maxW="360px"
      >
        <Heading size="md" mb={1}>CloudBench</Heading>
        <Text fontSize="sm" color="gray.500" mb={6}>
          Sign in to manage your connections
        </Text>

        <FormControl mb={4} isRequired>
          <FormLabel fontSize="sm">Username</FormLabel>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </FormControl>

        <FormControl mb={2} isRequired>
          <FormLabel fontSize="sm">Password</FormLabel>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormControl>

        {error && (
          <Text fontSize="sm" color="red.500" mt={2}>
            {error}
          </Text>
        )}

        <Button
          type="submit"
          colorScheme="kartoza"
          width="full"
          mt={6}
          isLoading={loading}
        >
          Sign in
        </Button>
      </Box>
    </Flex>
  )
}

import { Component, type ErrorInfo, type ReactNode } from 'react'
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalOverlay,
  VStack,
} from '@chakra-ui/react'

interface ErrorBoundaryProps {
  children: ReactNode
  // What failed, for the message ("this panel", "this dialog").
  label?: string
  // Called by "Try again", e.g. to close a dialog that keeps failing.
  onReset?: () => void
  // Show the error in a modal (for dialogs, which render outside the layout).
  asModal?: boolean
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Keeps a rendering error in one part of the app (a panel, a dialog) from
 * blanking the whole page: that part shows the error instead. Give it a `key`
 * that changes with what it shows (the selected node, the open dialog) so the
 * next one renders afresh.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const message = (
      <Box p={this.props.asModal ? 0 : 6}>
        <Alert status="error" borderRadius="md" alignItems="flex-start">
          <AlertIcon />
          <VStack align="start" spacing={2}>
            <AlertTitle>Something went wrong showing {this.props.label ?? 'this'}.</AlertTitle>
            <AlertDescription fontSize="sm" wordBreak="break-word">
              {error.message}
            </AlertDescription>
            <Button size="sm" onClick={this.reset}>
              {this.props.asModal ? 'Close' : 'Try again'}
            </Button>
          </VStack>
        </Alert>
      </Box>
    )
    if (!this.props.asModal) return message
    return (
      <Modal isOpen onClose={this.reset} isCentered size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalBody p={4}>{message}</ModalBody>
        </ModalContent>
      </Modal>
    )
  }
}

export default ErrorBoundary

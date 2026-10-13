import { useRef } from 'react'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  Checkbox,
  Link,
  Text,
  VStack,
} from '@chakra-ui/react'

interface S3UploadDialogServerWarningProps {
  isOpen: boolean
  autoDestroy: boolean
  // Auto destroy can still be turned on or off here, before continuing.
  onAutoDestroyChange: (autoDestroy: boolean) => void
  // GeoHosting's "Server on Demand" page, where a kept server is deleted.
  serversUrl?: string
  onCancel: () => void
  onContinue: () => void
}

// On demand, before starting a new server: what becomes of it, and its
// bill, once the job is done - auto destroyed (not reusable, the next job
// billed for a new one), or kept running (reusable, billed until deleted).
export default function S3UploadDialogServerWarning({
  isOpen,
  autoDestroy,
  onAutoDestroyChange,
  serversUrl,
  onCancel,
  onContinue,
}: S3UploadDialogServerWarningProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onCancel} isCentered>
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize="lg">
            {autoDestroy ? 'The server will be destroyed after this job' : 'The server will keep running'}
          </AlertDialogHeader>
          <AlertDialogBody>
            <Checkbox
              isChecked={autoDestroy}
              onChange={(e) => onAutoDestroyChange(e.target.checked)}
              colorScheme="orange"
              mb={3}
            >
              Auto destroy
            </Checkbox>
            {autoDestroy ? (
              <VStack align="stretch" spacing={3} fontSize="sm">
                <Text>
                  <b>Auto destroy is on:</b> the server started for this job is destroyed once the job is
                  done, and can't be reused for another job.
                </Text>
                <Text>
                  Each server is billed per hour, on its own, so the next job starts a new
                  server, and is billed for it again.
                </Text>
              </VStack>
            ) : (
              <VStack align="stretch" spacing={3} fontSize="sm">
                <Text>
                  <b>Auto destroy is off:</b> the server keeps running after this job is done, so the next
                  jobs can reuse it. It is billed per hour for as long as it runs.
                </Text>
                <Text>
                  To stop it, delete it on the{' '}
                  {serversUrl ? (
                    <Link href={serversUrl} isExternal color="orange.500">
                      Server on Demand
                    </Link>
                  ) : (
                    'Server on Demand'
                  )}{' '}
                  page.
                </Text>
              </VStack>
            )}
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button colorScheme="orange" ml={3} onClick={onContinue}>
              Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  )
}

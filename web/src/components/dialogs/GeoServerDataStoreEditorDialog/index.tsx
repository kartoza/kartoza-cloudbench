import { useRef, useState } from 'react'
import {
  Box,
  Button,
  HStack,
  Icon,
  Modal,
  VStack,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalOverlay,
  Text,
} from '@chakra-ui/react'
import {
  PGEditorMode,
  PGEditorModeType,
  PGStore,
  PGStoreIcon,
  PGStoreText
} from "./types.ts";
import GeoServerDataStoreEditor from "./GeoServerDataStoreEditor";
import { useUIStore, type DialogType } from '../../../stores/uiStore'
import { useTreeStore } from '../../../stores/treeStore'

export default function GeoServerDataStoreEditorDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const selectedNode = useTreeStore((state) => state.selectedNode)
  const mode = (dialogData?.mode ?? '') as PGEditorModeType
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, setIsPending] = useState(false)
  const isOpen = activeDialog !== null && ([PGStore.DATASTORE, PGStore.COVERAGE_STORE] as DialogType[]).includes(activeDialog) && [PGEditorMode.CREATE, PGEditorMode.EDIT].includes(mode);
  const connectionId = (dialogData?.data?.connectionId as string) || selectedNode?.connectionId || ''
  const workspace = (dialogData?.data?.workspace as string) || selectedNode?.workspace || ''
  const storeName = (dialogData?.data?.storeName as string) || selectedNode?.name || ''

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="xl" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)"/>
      <ModalContent
        borderRadius="xl" overflow="hidden" maxH="85vh"
      >
        {/* Gradient Header */}
        <Box
          bg={"linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)"}
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon
                as={PGStoreIcon[activeDialog! as keyof typeof PGStoreIcon]}
                boxSize={5}
                color="white"
              />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {mode.charAt(0).toUpperCase() + mode.slice(1)} {PGStoreText[activeDialog! as keyof typeof PGStoreText]}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">{storeName}</Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white"/>

        <ModalBody py={6} overflowY="auto">
          {
            activeDialog === PGStore.DATASTORE
              ? <GeoServerDataStoreEditor
                connectionId={connectionId}
                workspace={workspace}
                storeName={storeName}
                mode={mode}
                formRef={formRef}
                onPendingChange={setIsPending}/>
              : (
                <VStack py={10} spacing={2}>
                  <Icon as={PGStoreIcon[activeDialog! as keyof typeof PGStoreIcon]} boxSize={8} color="gray.300"/>
                  <Text color="gray.500" fontWeight="medium">Work in progress</Text>
                  <Text fontSize="sm" color="gray.400">
                    This store type editor is not yet available.
                  </Text>
                </VStack>
              )
          }
        </ModalBody>

        <ModalFooter
          gap={3}
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          {activeDialog === PGStore.DATASTORE && (
            <Button
              colorScheme="kartoza"
              borderRadius="lg"
              px={6}
              isLoading={isPending}
              loadingText="Saving..."
              onClick={() => formRef.current?.requestSubmit()}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)} Data Store
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

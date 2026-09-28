import { useEffect, useState } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  Badge,
  Box,
  HStack,
  VStack,
  Text,
  Spinner,
  Progress,
  Code,
} from '@chakra-ui/react'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'
import type { PortolanLayerCheck, PortolanLayerRef } from '../../api/s3'

type LayerState = PortolanLayerRef & { check?: PortolanLayerCheck; error?: string }

const STATUS: Record<PortolanLayerCheck['status'], { label: string; color: string }> = {
  ok: { label: 'Verified', color: 'green' },
  mismatch: { label: 'Mismatch', color: 'red' },
  unverifiable: { label: 'No checksums', color: 'gray' },
  unreadable: { label: 'Unreadable', color: 'orange' },
}

// Re-hashes every published layer's files in the connection's bucket and
// compares them with the checksums recorded in each collection.json — one
// layer per request, so progress shows and large buckets don't time out.
export default function S3VerifyDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const isOpen = activeDialog === 's3verify'
  const connectionId = dialogData?.data?.connectionId as string | undefined

  const [layers, setLayers] = useState<LayerState[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState(0)
  // Folders whose checksums are being recorded right now.
  const [recording, setRecording] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isOpen || !connectionId) return
    let cancelled = false
    setLayers(null)
    setListError(null)
    setRunning(true)

    const run = async () => {
      let refs: PortolanLayerRef[]
      try {
        refs = await api.listPortolanLayers(connectionId)
      } catch (err) {
        if (!cancelled) {
          setListError((err as Error).message)
          setRunning(false)
        }
        return
      }
      if (cancelled) return
      setLayers(refs.map((ref) => ({ ...ref })))
      for (const ref of refs) {
        let update: Partial<LayerState>
        try {
          update = { check: await api.verifyPortolanLayer(connectionId, ref.folder) }
        } catch (err) {
          update = { error: (err as Error).message }
        }
        if (cancelled) return
        setLayers((current) =>
          current?.map((layer) => (layer.folder === ref.folder ? { ...layer, ...update } : layer)) ?? null
        )
      }
      if (!cancelled) setRunning(false)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [isOpen, connectionId, runId])

  const updateLayer = (folder: string, update: Partial<LayerState>) =>
    setLayers((current) =>
      current?.map((layer) => (layer.folder === folder ? { ...layer, ...update } : layer)) ?? null
    )

  // Records checksums from a layer's files as they are now (only offered for
  // layers with none), then shows its fresh verification result.
  const recordLayer = async (folder: string) => {
    if (!connectionId) return
    setRecording((current) => new Set(current).add(folder))
    try {
      updateLayer(folder, { check: await api.recordPortolanChecksums(connectionId, folder), error: undefined })
    } catch (err) {
      updateLayer(folder, { error: (err as Error).message })
    } finally {
      setRecording((current) => {
        const next = new Set(current)
        next.delete(folder)
        return next
      })
    }
  }

  const unverifiable = layers?.filter((layer) => layer.check?.status === 'unverifiable') ?? []
  const recordAll = async () => {
    for (const layer of unverifiable) await recordLayer(layer.folder)
  }

  const done = layers?.filter((layer) => layer.check || layer.error).length ?? 0
  const failed = layers?.filter(
    (layer) => layer.error || layer.check?.status === 'mismatch' || layer.check?.status === 'unreadable'
  ).length ?? 0

  return (
    <Modal isOpen={isOpen} onClose={closeDialog} size="xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader bg="surface.header" color="white" borderTopRadius="md">
          Verify checksums
        </ModalHeader>
        <ModalCloseButton color="white" />
        <ModalBody py={4}>
          <Text fontSize="sm" color="gray.600" mb={3}>
            Re-reads each published layer&apos;s files and checks them against the checksums recorded in its
            catalog entry. A mismatch means a file was changed or removed without re-publishing the layer.
          </Text>

          {listError && <Text color="red.500">{listError}</Text>}
          {!layers && !listError && (
            <HStack py={6} justify="center">
              <Spinner size="sm" />
              <Text color="gray.600">Reading the catalog…</Text>
            </HStack>
          )}
          {layers && layers.length === 0 && (
            <Text color="gray.500">This bucket has no published layers (no catalog.json).</Text>
          )}

          {layers && layers.length > 0 && (
            <VStack align="stretch" spacing={2}>
              <Progress
                value={(done / layers.length) * 100}
                size="xs"
                colorScheme={failed ? 'red' : 'green'}
                borderRadius="full"
                isAnimated={running}
              />
              <Text fontSize="xs" color="gray.500">
                {done} of {layers.length} layer{layers.length === 1 ? '' : 's'} checked
                {failed ? ` · ${failed} with problems` : ''}
              </Text>
              {layers.map((layer) => (
                <Box key={layer.folder} borderWidth="1px" borderRadius="md" p={3}>
                  <HStack justify="space-between">
                    <VStack align="start" spacing={0}>
                      <Text fontWeight="semibold">{layer.check?.title ?? layer.title}</Text>
                      <Text fontSize="xs" color="gray.500">{layer.folder}/</Text>
                    </VStack>
                    {layer.error ? (
                      <Badge colorScheme="orange">Error</Badge>
                    ) : layer.check ? (
                      <Badge colorScheme={STATUS[layer.check.status].color}>
                        {STATUS[layer.check.status].label}
                        {layer.check.status === 'ok' ? ` · ${layer.check.files.length} files` : ''}
                      </Badge>
                    ) : (
                      <Spinner size="sm" color="gray.400" />
                    )}
                  </HStack>
                  {layer.error && <Text fontSize="sm" color="orange.600" mt={2}>{layer.error}</Text>}
                  {layer.check?.status === 'unverifiable' && (
                    <HStack mt={2} justify="space-between" align="start" spacing={3}>
                      <Text fontSize="xs" color="gray.500">
                        Published before checksums were recorded. Add them from the files as they are now
                        (catches changes from here on), or re-publish the layer.
                      </Text>
                      <Button
                        size="xs"
                        variant="outline"
                        colorScheme="accent"
                        flexShrink={0}
                        onClick={() => recordLayer(layer.folder)}
                        isLoading={recording.has(layer.folder)}
                        loadingText="Adding"
                        isDisabled={running}
                      >
                        Add checksums
                      </Button>
                    </HStack>
                  )}
                  {layer.check?.files
                    .filter((file) => file.status !== 'ok')
                    .map((file) => (
                      <HStack key={file.key} mt={2} spacing={2} fontSize="sm">
                        <Badge colorScheme="red" variant="subtle">
                          {file.status === 'missing' ? 'Missing' : 'Changed'}
                        </Badge>
                        <Code fontSize="xs">{file.key}</Code>
                      </HStack>
                    ))}
                </Box>
              ))}
            </VStack>
          )}
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={closeDialog}>Close</Button>
          {unverifiable.length > 0 && (
            <Button
              variant="outline"
              colorScheme="accent"
              onClick={recordAll}
              isDisabled={running || recording.size > 0}
            >
              Add checksums to all ({unverifiable.length})
            </Button>
          )}
          <Button
            colorScheme="accent"
            onClick={() => setRunId((id) => id + 1)}
            isDisabled={running || recording.size > 0 || !connectionId}
            isLoading={running}
            loadingText="Verifying"
          >
            Verify again
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

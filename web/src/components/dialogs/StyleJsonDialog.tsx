import { useEffect, useState } from 'react'
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Textarea,
} from '@chakra-ui/react'
import { getStyleFile, saveStyleFile } from '../../api/mapExplorer'

// A style file in a bucket, edited as JSON.
export interface StyleJsonTarget {
  connectionId: string
  // The style's own key, e.g. "<layer folder>/styles/default.json".
  styleKey: string
  name: string
  // Shown when the file doesn't exist yet.
  fallback?: Record<string, unknown>
}

interface StyleJsonDialogProps {
  target: StyleJsonTarget | null
  onClose: () => void
  onSaved?: () => void
}

// Returns why `text` isn't a MapLibre style the layer can be saved with.
export function styleProblem(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return `Not valid JSON: ${(error as Error).message}`
  }
  const style = parsed as { version?: unknown; layers?: unknown } | null
  if (!style || typeof style !== 'object' || style.version !== 8 || !Array.isArray(style.layers)) {
    return 'A MapLibre style needs "version": 8 and a "layers" list.'
  }
  return null
}

export default function StyleJsonDialog({ target, onClose, onSaved }: StyleJsonDialogProps) {
  const [text, setText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    getStyleFile(target.connectionId, target.styleKey).then((style) => {
      if (cancelled) return
      setText(JSON.stringify(style ?? target.fallback ?? { version: 8, sources: {}, layers: [] }, null, 2))
      setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [target])

  async function save() {
    if (!target) return
    const problem = styleProblem(text)
    if (problem) {
      setError(problem)
      return
    }
    setIsSaving(true)
    try {
      await saveStyleFile(target.connectionId, target.styleKey, JSON.parse(text))
      onSaved?.()
      onClose()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={!!target} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Edit style: {target?.name}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {isLoading ? (
            <Spinner />
          ) : (
            <FormControl isInvalid={!!error}>
              <Textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setError(null)
                }}
                fontFamily="mono"
                fontSize="sm"
                minH="360px"
                spellCheck={false}
              />
              {error ? (
                <FormErrorMessage>{error}</FormErrorMessage>
              ) : (
                <FormHelperText>
                  A MapLibre style. For a raster layer: raster-opacity, raster-hue-rotate,
                  raster-saturation, raster-contrast and raster-brightness-min/max.
                </FormHelperText>
              )}
            </FormControl>
          )}
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button colorScheme="accent" onClick={save} isLoading={isSaving} isDisabled={isLoading}>
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

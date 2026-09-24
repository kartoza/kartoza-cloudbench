import { useState, useEffect, useRef } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  Box,
  Text,
  VStack,
  HStack,
  Icon,
  FormControl,
  FormLabel,
  Input,
  FormHelperText,
  Progress,
  useToast,
} from '@chakra-ui/react'
import { FiMap, FiUpload, FiFile, FiX } from 'react-icons/fi'
import { SiQgis } from 'react-icons/si'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/uiStore'
import * as api from '../../api'

export default function QGISProjectDialog() {
  const activeDialog = useUIStore((state) => state.activeDialog)
  const dialogData = useUIStore((state) => state.dialogData)
  const closeDialog = useUIStore((state) => state.closeDialog)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [name, setName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isOpen = activeDialog === 'qgisproject'
  const isEditing = !!dialogData?.data?.projectId
  const projectId = dialogData?.data?.projectId as string | undefined

  // Load existing project data when editing
  useEffect(() => {
    if (isOpen && isEditing && projectId) {
      api.getQGISProject(projectId).then((project) => {
        setName(project.name)
      }).catch((err) => {
        toast({
          title: 'Failed to load project',
          description: err.message,
          status: 'error',
          duration: 3000,
        })
      })
    } else if (isOpen && !isEditing) {
      setName('')
      setSelectedFile(null)
      setUploadProgress(0)
    }
  }, [isOpen, isEditing, projectId, toast])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file extension
    const ext = file.name.toLowerCase().split('.').pop()
    if (ext !== 'qgs' && ext !== 'qgz') {
      toast({
        title: 'Invalid file type',
        description: 'Please select a QGIS project file (.qgs or .qgz)',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setSelectedFile(file)
    // Auto-fill name from filename if not set
    if (!name) {
      const nameWithoutExt = file.name.replace(/\.(qgs|qgz)$/i, '')
      setName(nameWithoutExt)
    }
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmit = async () => {
    if (!isEditing && !selectedFile) {
      toast({
        title: 'File required',
        description: 'Please select a QGIS project file to upload',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setIsLoading(true)
    setUploadProgress(0)

    try {
      if (isEditing && projectId) {
        // For editing, just update the name
        await api.updateQGISProject(projectId, {
          name: name.trim() || undefined,
        })
        toast({
          title: 'Project updated',
          status: 'success',
          duration: 2000,
        })
      } else if (selectedFile) {
        // For new projects, upload the file
        await api.uploadQGISProject(selectedFile, name.trim(), (progress) => {
          setUploadProgress(progress)
        })
        toast({
          title: 'Project uploaded',
          description: 'QGIS project has been uploaded and added to your list',
          status: 'success',
          duration: 2000,
        })
      }

      queryClient.invalidateQueries({ queryKey: ['qgisprojects'] })
      closeDialog()
    } catch (err) {
      toast({
        title: isEditing ? 'Failed to update project' : 'Failed to upload project',
        description: (err as Error).message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
      setUploadProgress(0)
    }
  }

  const handleClose = () => {
    setName('')
    setSelectedFile(null)
    setUploadProgress(0)
    closeDialog()
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent borderRadius="xl" overflow="hidden">
        {/* Gradient Header - QGIS green theme */}
        <Box
          bg="surface.header"
          px={6}
          py={4}
        >
          <HStack spacing={3}>
            <Box bg="whiteAlpha.200" p={2} borderRadius="lg">
              <Icon as={SiQgis} boxSize={5} color="white" />
            </Box>
            <Box>
              <Text color="white" fontWeight="600" fontSize="lg">
                {isEditing ? 'Edit QGIS Project' : 'Upload QGIS Project'}
              </Text>
              <Text color="whiteAlpha.800" fontSize="sm">
                {isEditing ? 'Update project details' : 'Upload a QGIS project file'}
              </Text>
            </Box>
          </HStack>
        </Box>
        <ModalCloseButton color="white" />

        <ModalBody py={6}>
          <VStack spacing={4}>
            {!isEditing && (
              <FormControl>
                <FormLabel>
                  <HStack spacing={2}>
                    <Icon as={FiUpload} color="green.500" />
                    <Text>Project File</Text>
                  </HStack>
                </FormLabel>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".qgs,.qgz"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />

                {selectedFile ? (
                  <Box
                    p={4}
                    borderWidth={1}
                    borderRadius="lg"
                    borderColor="green.200"
                    bg="green.50"
                  >
                    <HStack justify="space-between">
                      <HStack spacing={3}>
                        <Icon as={FiFile} color="green.500" boxSize={5} />
                        <Box>
                          <Text fontWeight="500" noOfLines={1}>
                            {selectedFile.name}
                          </Text>
                          <Text fontSize="sm" color="gray.600">
                            {formatFileSize(selectedFile.size)}
                          </Text>
                        </Box>
                      </HStack>
                      <Button
                        size="sm"
                        variant="ghost"
                        colorScheme="red"
                        onClick={handleRemoveFile}
                        leftIcon={<FiX />}
                      >
                        Remove
                      </Button>
                    </HStack>
                  </Box>
                ) : (
                  <Box
                    p={8}
                    borderWidth={2}
                    borderStyle="dashed"
                    borderRadius="lg"
                    borderColor="gray.300"
                    bg="gray.50"
                    textAlign="center"
                    cursor="pointer"
                    _hover={{ borderColor: 'green.400', bg: 'green.50' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <VStack spacing={2}>
                      <Icon as={FiUpload} boxSize={8} color="gray.400" />
                      <Text color="gray.600">
                        Click to select a QGIS project file
                      </Text>
                      <Text fontSize="sm" color="gray.500">
                        Supported formats: .qgs, .qgz
                      </Text>
                    </VStack>
                  </Box>
                )}

                <FormHelperText>
                  The project will be uploaded and stored on the server. Projects using PostgreSQL
                  connections via pg_service.conf will use the server's pg_service configuration.
                </FormHelperText>
              </FormControl>
            )}

            <FormControl>
              <FormLabel>
                <HStack spacing={2}>
                  <Icon as={FiMap} color="green.500" />
                  <Text>Display Name {!isEditing && '(optional)'}</Text>
                </HStack>
              </FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My QGIS Project"
                borderRadius="lg"
              />
              <FormHelperText>
                A friendly name for the project. {!isEditing && 'If left empty, the filename will be used.'}
              </FormHelperText>
            </FormControl>

            {isLoading && uploadProgress > 0 && (
              <Box w="100%">
                <HStack justify="space-between" mb={1}>
                  <Text fontSize="sm" color="gray.600">Uploading...</Text>
                  <Text fontSize="sm" color="gray.600">{uploadProgress}%</Text>
                </HStack>
                <Progress
                  value={uploadProgress}
                  size="sm"
                  colorScheme="green"
                  borderRadius="sm"
                  hasStripe
                  isAnimated
                />
              </Box>
            )}
          </VStack>
        </ModalBody>

        <ModalFooter
          gap={3}
          borderTop="1px solid"
          borderTopColor="gray.100"
          bg="gray.50"
        >
          <Button variant="ghost" onClick={handleClose} borderRadius="lg">
            Cancel
          </Button>
          <Button
            colorScheme="green"
            onClick={handleSubmit}
            isLoading={isLoading}
            loadingText={isEditing ? 'Updating...' : 'Uploading...'}
            borderRadius="lg"
            px={6}
            isDisabled={!isEditing && !selectedFile}
          >
            {isEditing ? 'Update' : 'Upload Project'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

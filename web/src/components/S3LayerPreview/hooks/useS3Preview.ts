import { useState, useEffect, useCallback } from 'react'
import * as api from '../../../api'
import type { S3PreviewMetadata } from '../../../types'

interface UseS3PreviewResult {
  metadata: S3PreviewMetadata | null
  isLoading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Hook for loading S3 preview metadata
 */
export function useS3Preview(
  connectionId: string,
  objectKey: string
): UseS3PreviewResult {
  const [metadata, setMetadata] = useState<S3PreviewMetadata | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadMetadata = useCallback(() => {
    setIsLoading(true)
    setError(null)

    api.getS3PreviewMetadata(connectionId, objectKey)
      .then((data) => {
        setMetadata(data)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch S3 preview metadata:', err)
        setError(err.message || 'Failed to load preview')
        setIsLoading(false)
      })
  }, [connectionId, objectKey])

  // Load on mount and when dependencies change
  useEffect(() => {
    loadMetadata()
  }, [loadMetadata])

  return {
    metadata,
    isLoading,
    error,
    refresh: loadMetadata,
  }
}

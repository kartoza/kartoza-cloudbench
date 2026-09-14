import { useState, useRef, useCallback } from 'react'
import {
  initUploadSession,
  uploadChunk,
  completeUpload,
  cancelUpload,
  CHUNK_SIZE,
} from '../api/chunkedUpload'
import type { UploadResult } from '../types'

export type UploadStatus = 'idle' | 'uploading' | 'paused' | 'completed' | 'error' | 'cancelled'

export interface ChunkUploadState {
  status: UploadStatus
  chunksTotal: number
  chunksUploaded: number
  currentChunkProgress: number
  bytesUploaded: number
  totalBytes: number
  speedBps: number
  etaSeconds: number
  geoServerSent: number
  geoServerTotal: number
  error?: string
}

export interface UseChunkedUpload {
  state: ChunkUploadState
  start: (connId: string, workspace: string, file: File) => Promise<UploadResult>
  pause: () => void
  resume: () => void
  cancel: () => Promise<void>
  reset: () => void
}

const initialState: ChunkUploadState = {
  status: 'idle',
  chunksTotal: 0,
  chunksUploaded: 0,
  currentChunkProgress: 0,
  bytesUploaded: 0,
  totalBytes: 0,
  speedBps: 0,
  etaSeconds: 0,
  geoServerSent: 0,
  geoServerTotal: 0,
}

export function useChunkedUpload(): UseChunkedUpload {
  const [state, setState] = useState<ChunkUploadState>(initialState)

  const isPaused = useRef(false)
  const isCancelled = useRef(false)
  const sessionIdRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    isPaused.current = false
    isCancelled.current = false
    sessionIdRef.current = null
    setState(initialState)
  }, [])

  const pause = useCallback(() => {
    isPaused.current = true
    setState((prev) => ({ ...prev, status: 'paused' }))
  }, [])

  const resume = useCallback(() => {
    isPaused.current = false
    setState((prev) => ({ ...prev, status: 'uploading' }))
  }, [])

  const cancel = useCallback(async () => {
    isCancelled.current = true
    const sessId = sessionIdRef.current
    if (sessId) {
      try {
        await cancelUpload(sessId)
      } catch {
        // Best-effort cancel
      }
    }
    setState((prev) => ({ ...prev, status: 'cancelled' }))
  }, [])

  const waitIfPaused = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const check = () => {
        if (!isPaused.current || isCancelled.current) {
          resolve()
        } else {
          setTimeout(check, 200)
        }
      }
      check()
    })
  }, [])

  const start = useCallback(
    async (connId: string, workspace: string, file: File): Promise<UploadResult> => {
      isPaused.current = false
      isCancelled.current = false
      sessionIdRef.current = null

      const totalBytes = file.size
      const chunkSize = CHUNK_SIZE

      setState({
        ...initialState,
        status: 'uploading',
        totalBytes,
      })

      // Init session
      const { sessionId, totalChunks } = await initUploadSession(
        connId,
        workspace,
        file.name,
        totalBytes,
        chunkSize,
      )
      sessionIdRef.current = sessionId

      setState((prev) => ({ ...prev, chunksTotal: totalChunks }))

      const startTime = Date.now()
      let bytesUploaded = 0

      for (let i = 0; i < totalChunks; i++) {
        if (isCancelled.current) {
          break
        }

        await waitIfPaused()

        if (isCancelled.current) {
          break
        }

        const start = i * chunkSize
        const end = Math.min(start + chunkSize, totalBytes)
        const chunk = file.slice(start, end)
        const chunkBytes = end - start

        await uploadChunk(sessionId, i, chunk, (pct) => {
          setState((prev) => ({ ...prev, currentChunkProgress: pct }))
        })

        bytesUploaded += chunkBytes
        const elapsedSec = (Date.now() - startTime) / 1000
        const speedBps = elapsedSec > 0 ? bytesUploaded / elapsedSec : 0
        const remaining = totalBytes - bytesUploaded
        const etaSeconds = speedBps > 0 ? remaining / speedBps : 0

        setState((prev) => ({
          ...prev,
          chunksUploaded: i + 1,
          currentChunkProgress: 100,
          bytesUploaded,
          speedBps,
          etaSeconds,
        }))
      }

      if (isCancelled.current) {
        setState((prev) => ({ ...prev, status: 'cancelled' }))
        throw new Error('Upload cancelled')
      }

      const result = await completeUpload(sessionId)

      if (!result.success && !result.published) {
        const errMsg = result.message || 'GeoServer rejected the upload'
        setState((prev) => ({ ...prev, status: 'error', error: errMsg }))
        throw new Error(errMsg)
      }

      setState((prev) => ({
        ...prev,
        status: 'completed',
        bytesUploaded: totalBytes,
        currentChunkProgress: 100,
        etaSeconds: 0,
      }))

      return result
    },
    [waitIfPaused],
  )

  return { state, start, pause, resume, cancel, reset }
}

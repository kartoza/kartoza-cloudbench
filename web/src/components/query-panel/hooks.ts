// Custom hooks for QueryPanel

import { useState, useEffect, useCallback, useRef } from 'react'
import type { SchemaInfo, QueryResult, AIResponse } from './types'
import { getApiBase } from '../../config/env'

/**
 * Hook to manage schema loading
 */
export function useSchemas(serviceName: string, initialSchema?: string) {
  const [schemas, setSchemas] = useState<SchemaInfo[]>([])
  const [loadingSchemas, setLoadingSchemas] = useState(true)
  const [selectedSchema, setSelectedSchema] = useState(initialSchema || 'public')

  useEffect(() => {
    setLoadingSchemas(true)
    fetch(`${getApiBase()}/pg/services/${encodeURIComponent(serviceName)}/schemas`)
      .then(res => res.json())
      .then(data => {
        if (data.schemas) {
          setSchemas(data.schemas)
          if (data.schemas.length > 0 && !selectedSchema) {
            setSelectedSchema(data.schemas[0].name)
          }
        }
      })
      .catch(err => {
        console.error('Failed to load schemas:', err)
      })
      .finally(() => setLoadingSchemas(false))
  }, [serviceName])

  return { schemas, loadingSchemas, selectedSchema, setSelectedSchema }
}

/**
 * Hook to check AI provider availability
 */
export function useAIProvider() {
  const [aiProviderAvailable, setAiProviderAvailable] = useState(true)

  useEffect(() => {
    fetch(`${getApiBase()}/ai/providers`)
      .then(res => res.json())
      .then(data => {
        const active = data.providers?.find((p: { active: boolean }) => p.active)
        setAiProviderAvailable(active?.available ?? false)
      })
      .catch(() => setAiProviderAvailable(false))
  }, [])

  return aiProviderAvailable
}

/**
 * Hook to manage query execution
 */
export function useQueryExecution(serviceName: string, limit: number) {
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  const executeQuery = useCallback(async (sql: string, appendResults = false) => {
    if (!sql.trim()) {
      setError('Please enter a query')
      return
    }

    if (appendResults) {
      setLoadingMore(true)
    } else {
      setExecuting(true)
      setError('')
      setResult(null)
    }

    try {
      const response = await fetch(`${getApiBase()}/pg/services/${encodeURIComponent(serviceName)}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: sql,
          limit,
        }),
      })

      const data = await response.json()

      if (data.success) {
        const rows = data.result?.rows || []
        const columns = data.result?.columns || []

        if (appendResults && result) {
          setResult({
            ...data.result,
            columns,
            rows: [...(result.rows || []), ...rows],
            has_more: rows.length === limit,
          })
        } else {
          setResult({
            ...data.result,
            columns,
            rows,
            has_more: rows.length === limit,
          })
        }
      } else {
        setError(data.error || 'Query execution failed')
      }
    } catch (err) {
      setError('Failed to execute query: ' + (err as Error).message)
    } finally {
      setExecuting(false)
      setLoadingMore(false)
    }
  }, [serviceName, limit, result])

  return { executing, result, error, loadingMore, executeQuery, setError }
}

/**
 * Hook to manage AI query generation
 */
export function useAIQuery(serviceName: string, selectedSchema: string, limit: number) {
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null)

  const handleAIQuery = useCallback(async (onError: (error: string) => void) => {
    if (!aiQuestion.trim() || aiLoading) return

    setAiLoading(true)
    setAiResponse(null)
    onError('')

    try {
      const response = await fetch(`${getApiBase()}/ai/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: aiQuestion.trim(),
          service_name: serviceName,
          schema_name: selectedSchema,
          max_rows: limit,
          execute: false,
        }),
      })

      const data = await response.json()

      if (data.success && data.sql) {
        setAiResponse({
          sql: data.sql,
          explanation: data.explanation,
          confidence: data.confidence,
          warnings: data.warnings,
        })
        return data.sql
      } else {
        onError(data.error || 'AI query generation failed')
      }
    } catch (err) {
      onError('AI query failed: ' + (err as Error).message)
    } finally {
      setAiLoading(false)
    }
  }, [aiQuestion, aiLoading, serviceName, selectedSchema, limit])

  return { aiQuestion, setAiQuestion, aiLoading, aiResponse, handleAIQuery }
}

/**
 * Hook to manage resizable splitter
 */
export function useResizableSplitter() {
  const [splitPosition, setSplitPosition] = useState(() => {
    const saved = localStorage.getItem('query-panel-split')
    return saved ? parseInt(saved, 10) : 50
  })
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const splitPositionRef = useRef(splitPosition)

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    splitPositionRef.current = splitPosition
  }, [splitPosition])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newPosition = ((e.clientX - rect.left) / rect.width) * 100
      const clamped = Math.max(25, Math.min(75, newPosition))
      setSplitPosition(clamped)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      localStorage.setItem('query-panel-split', splitPositionRef.current.toString())
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  return {
    splitPosition,
    isDragging,
    containerRef,
    handleSplitterMouseDown,
  }
}

/**
 * Hook to manage infinite scroll
 */
export function useInfiniteScroll(
  result: QueryResult | null,
  loadingMore: boolean,
  onLoadMore: () => void
) {
  const tableContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = tableContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight - scrollTop - clientHeight < 100 && result?.has_more && !loadingMore) {
        onLoadMore()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [result, loadingMore, onLoadMore])

  return tableContainerRef
}

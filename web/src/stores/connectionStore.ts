import { create } from 'zustand'
import type { Connection } from '../types'
import * as api from '../api/client'
import type { PGService } from '../api/client'

interface ConnectionState {
  connections: Connection[]
  pgServices: PGService[]
  activeConnectionId: string | null
  isLoading: boolean
  error: string | null

  // Actions
  fetchConnections: () => Promise<void>
  addConnection: (conn: { name: string; url: string; username: string; password: string }) => Promise<Connection>
  updateConnection: (id: string, conn: Partial<{ name: string; url: string; username: string; password: string }>) => Promise<void>
  removeConnection: (id: string) => Promise<void>
  setActiveConnection: (id: string | null) => void
  testConnection: (id: string) => Promise<{ success: boolean; message: string }>
  clearError: () => void

  // PostgreSQL service actions
  refreshPGServices: () => Promise<void>
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  pgServices: [],
  activeConnectionId: null,
  isLoading: false,
  error: null,

  fetchConnections: async () => {
    set({ isLoading: true, error: null })
    try {
      const connections = await api.getConnections()
      const activeConn = connections.find(c => c.isActive)
      set({
        connections,
        activeConnectionId: activeConn?.id ?? null,
        isLoading: false,
      })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  addConnection: async (conn) => {
    set({ isLoading: true, error: null })
    try {
      const newConn = await api.createConnection(conn)
      set(state => ({
        connections: [...state.connections, newConn],
        isLoading: false,
      }))
      return newConn
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
      throw err
    }
  },

  updateConnection: async (id, conn) => {
    set({ isLoading: true, error: null })
    try {
      const updated = await api.updateConnection(id, conn)
      set(state => ({
        connections: state.connections.map(c => c.id === id ? updated : c),
        isLoading: false,
      }))
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
      throw err
    }
  },

  removeConnection: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await api.deleteConnection(id)
      set(state => ({
        connections: state.connections.filter(c => c.id !== id),
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        isLoading: false,
      }))
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
      throw err
    }
  },

  setActiveConnection: (id) => {
    set({ activeConnectionId: id })
  },

  testConnection: async (id) => {
    try {
      const result = await api.testConnection(id)
      return { success: result.success, message: result.message }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  },

  clearError: () => set({ error: null }),

  refreshPGServices: async () => {
    try {
      const pgServices = await api.getPGServices()
      set({ pgServices })
    } catch (err) {
      console.error('Failed to fetch PG services:', err)
    }
  },
}))

import { create } from 'zustand'
import { API_BASE } from '../api/common'

export interface Provider {
  id: string
  name: string
  description: string
  enabled: boolean
  experimental: boolean
}

interface ProvidersState {
  providers: Provider[]
  isLoading: boolean
  error: string | null

  // Actions
  fetchProviders: () => Promise<void>
  isProviderEnabled: (providerId: string) => boolean
  updateProviders: (updates: { id: string; enabled: boolean }[]) => Promise<void>
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  isLoading: false,
  error: null,

  fetchProviders: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await fetch(`${API_BASE}/providers/`)
      if (!response.ok) {
        throw new Error('Failed to fetch providers')
      }
      const data = await response.json()
      set({ providers: data.providers, isLoading: false })
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
    }
  },

  isProviderEnabled: (providerId: string) => {
    const provider = get().providers.find((p) => p.id === providerId)
    return provider?.enabled ?? false
  },

  updateProviders: async (updates: { id: string; enabled: boolean }[]) => {
    set({ isLoading: true, error: null })
    try {
      const response = await fetch(`${API_BASE}/providers/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providers: updates }),
      })
      if (!response.ok) {
        throw new Error('Failed to update providers')
      }
      const data = await response.json()
      set({ providers: data.providers, isLoading: false })
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
    }
  },
}))

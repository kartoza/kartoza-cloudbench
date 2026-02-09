import { create } from 'zustand'

export type DialogType =
  | 'connection'
  | 'workspace'
  | 'datastore'
  | 'coveragestore'
  | 'layer'
  | 'layergroup'
  | 'style'
  | 'upload'
  | 'confirm'
  | 'info'
  | 'sync'
  | null

export type DialogMode = 'create' | 'edit' | 'delete' | 'view'

interface DialogData {
  mode: DialogMode
  data?: Record<string, unknown>
  title?: string
  message?: string
  onConfirm?: () => void | Promise<void>
}

interface PreviewState {
  url: string
  layerName: string
  workspace: string
  storeName?: string
  storeType?: string
  layerType?: string
}

interface UIState {
  // Dialog state
  activeDialog: DialogType
  dialogData: DialogData | null

  // Preview state
  activePreview: PreviewState | null

  // Status messages
  statusMessage: string
  errorMessage: string | null
  successMessage: string | null

  // Loading state
  isLoading: boolean

  // Sidebar state
  sidebarWidth: number

  // Actions
  openDialog: (type: DialogType, data?: DialogData) => void
  closeDialog: () => void
  setPreview: (preview: PreviewState | null) => void
  setStatus: (message: string) => void
  setError: (message: string | null) => void
  setSuccess: (message: string | null) => void
  setLoading: (loading: boolean) => void
  setSidebarWidth: (width: number) => void
  clearMessages: () => void
}

export const useUIStore = create<UIState>((set) => ({
  activeDialog: null,
  dialogData: null,
  activePreview: null,
  statusMessage: 'Ready',
  errorMessage: null,
  successMessage: null,
  isLoading: false,
  sidebarWidth: 300,

  openDialog: (type, data) => {
    set({ activeDialog: type, dialogData: data ?? null })
  },

  closeDialog: () => {
    set({ activeDialog: null, dialogData: null })
  },

  setPreview: (preview) => {
    set({ activePreview: preview })
  },

  setStatus: (message) => {
    set({ statusMessage: message })
  },

  setError: (message) => {
    set({ errorMessage: message })
    // Auto-clear error after 5 seconds
    if (message) {
      setTimeout(() => {
        set((state) => {
          if (state.errorMessage === message) {
            return { errorMessage: null }
          }
          return state
        })
      }, 5000)
    }
  },

  setSuccess: (message) => {
    set({ successMessage: message })
    // Auto-clear success after 3 seconds
    if (message) {
      setTimeout(() => {
        set((state) => {
          if (state.successMessage === message) {
            return { successMessage: null }
          }
          return state
        })
      }, 3000)
    }
  },

  setLoading: (loading) => {
    set({ isLoading: loading })
  },

  setSidebarWidth: (width) => {
    set({ sidebarWidth: Math.max(200, Math.min(600, width)) })
  },

  clearMessages: () => {
    set({ errorMessage: null, successMessage: null })
  },
}))

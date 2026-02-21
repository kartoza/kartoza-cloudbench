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
  | 'globe3d'
  | 'settings'
  | 'query'
  | 'dataviewer'
  | 'pgdashboard'
  | 'pgupload'
  | 's3connection'
  | 's3upload'
  | 'pointcloud'
  | null

export type DialogMode = 'create' | 'edit' | 'delete' | 'view'

interface DialogData {
  mode: DialogMode
  data?: Record<string, unknown>
  title?: string
  message?: string
  onConfirm?: () => void | Promise<void>
}

export type PreviewMode = '2d' | '3d'

interface PreviewState {
  url: string
  layerName: string
  workspace: string
  connectionId: string
  storeName?: string
  storeType?: string
  layerType?: string
  nodeType?: string // 'layer' | 'layergroup'
}

interface S3PreviewState {
  connectionId: string
  bucketName: string
  objectKey: string
}

interface Settings {
  showHiddenPGServices: boolean
  instanceName: string
}

interface UIState {
  // Dialog state
  activeDialog: DialogType
  dialogData: DialogData | null

  // Preview state
  activePreview: PreviewState | null
  previewMode: PreviewMode

  // S3 Preview state
  activeS3Preview: S3PreviewState | null

  // Status messages
  statusMessage: string
  errorMessage: string | null
  successMessage: string | null

  // Loading state
  isLoading: boolean

  // Sidebar state
  sidebarWidth: number

  // Settings
  settings: Settings

  // Actions
  openDialog: (type: DialogType, data?: DialogData) => void
  closeDialog: () => void
  setPreview: (preview: PreviewState | null) => void
  setPreviewMode: (mode: PreviewMode) => void
  setS3Preview: (preview: S3PreviewState | null) => void
  setStatus: (message: string) => void
  setError: (message: string | null) => void
  setSuccess: (message: string | null) => void
  setLoading: (loading: boolean) => void
  setSidebarWidth: (width: number) => void
  clearMessages: () => void
  setShowHiddenPGServices: (show: boolean) => void
  setInstanceName: (name: string) => void
}

// Load persisted settings from localStorage
const loadSettings = (): Settings => {
  try {
    const stored = localStorage.getItem('cloudbench-settings')
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Ignore parse errors
  }
  return { showHiddenPGServices: false, instanceName: 'My Cloudbench' }
}

// Save settings to localStorage
const saveSettings = (settings: Settings) => {
  try {
    localStorage.setItem('cloudbench-settings', JSON.stringify(settings))
  } catch {
    // Ignore save errors
  }
}

export const useUIStore = create<UIState>((set) => ({
  activeDialog: null,
  dialogData: null,
  activePreview: null,
  previewMode: '2d',
  activeS3Preview: null,
  statusMessage: 'Ready',
  errorMessage: null,
  successMessage: null,
  isLoading: false,
  sidebarWidth: 420,
  settings: loadSettings(),

  openDialog: (type, data) => {
    set({ activeDialog: type, dialogData: data ?? null })
  },

  closeDialog: () => {
    set({ activeDialog: null, dialogData: null })
  },

  setPreview: (preview) => {
    // Clear S3 preview when setting GeoServer preview
    set({ activePreview: preview, activeS3Preview: null })
  },

  setPreviewMode: (mode) => {
    set({ previewMode: mode })
  },

  setS3Preview: (preview) => {
    // Clear GeoServer preview when setting S3 preview
    set({ activeS3Preview: preview, activePreview: null })
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

  setShowHiddenPGServices: (show) => {
    set((state) => {
      const newSettings = { ...state.settings, showHiddenPGServices: show }
      saveSettings(newSettings)
      return { settings: newSettings }
    })
  },

  setInstanceName: (name) => {
    set((state) => {
      const newSettings = { ...state.settings, instanceName: name }
      saveSettings(newSettings)
      return { settings: newSettings }
    })
  },
}))

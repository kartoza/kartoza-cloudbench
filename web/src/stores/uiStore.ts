import { create } from 'zustand'

// Export MapViewState for use in preview components
export interface MapViewState {
  center: [number, number]  // [lng, lat]
  zoom: number
  pitch: number
  bearing: number
}

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
  | 'dataviewer'
  | 'pgdashboard'
  | 'pgupload'
  | 's3connection'
  | 's3upload'
  | 'pointcloud'
  | 'qgisproject'
  | 'qgispreview'
  | 'geonode'
  | 'geonodeupload'
  | 'geonodeaddremoteservice'
  | 'icebergconnection'
  | 'icebergnamespace'
  | 'icebergtable'
  | 'icebergtablepreview'
  | 'icebergtabledata'
  | 'icebergquery'
  | 'qfieldcloud'
  | 'merginmaps'
  | 'pgconnect'
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

interface QGISPreviewState {
  projectId: string
  projectName: string
}

interface GeoNodePreviewState {
  geonodeUrl: string    // Base URL of GeoNode (e.g., https://mygeocommunity.org)
  layerName: string     // The alternate field (e.g., geonode:layer_name)
  workspace: string     // Usually 'geonode'
  title: string         // Display title
  connectionId: string  // GeoNode connection ID
  detailUrl?: string    // Full URL to view this resource in GeoNode
}

interface DuckDBQueryState {
  connectionId: string  // S3 connection ID
  bucketName: string    // S3 bucket name
  objectKey: string     // Path to Parquet/GeoParquet file
  displayName: string   // Display name for the file
}

interface PGQueryState {
  serviceName: string   // PostgreSQL service name
  schemaName?: string   // Initial schema
  tableName?: string    // Initial table
  initialSQL?: string   // Initial SQL query
}

interface IcebergPreviewState {
  connectionId: string    // Iceberg connection ID
  connectionName: string  // Connection display name
  namespace: string       // Namespace name
  tableName: string       // Table name
}

interface JupyterPreviewState {
  connectionId: string    // Iceberg connection ID
  connectionName: string  // Connection display name
  jupyterUrl: string      // Jupyter URL
  namespace?: string      // Optional namespace context
  tableName?: string      // Optional table context
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

  // QGIS Preview state
  activeQGISPreview: QGISPreviewState | null

  // GeoNode Preview state
  activeGeoNodePreview: GeoNodePreviewState | null

  // GeoNode map view state (persisted across layer changes)
  geonodeMapView: MapViewState | null

  // DuckDB Query state (for S3 Parquet/GeoParquet files)
  activeDuckDBQuery: DuckDBQueryState | null

  // PostgreSQL Query state (for PG service queries)
  activePGQuery: PGQueryState | null

  // Iceberg Preview state (for Iceberg table preview)
  activeIcebergPreview: IcebergPreviewState | null

  // Jupyter Preview state (for embedded Jupyter notebook)
  activeJupyterPreview: JupyterPreviewState | null

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
  setQGISPreview: (preview: QGISPreviewState | null) => void
  setGeoNodePreview: (preview: GeoNodePreviewState | null) => void
  setGeoNodeMapView: (view: MapViewState | null) => void
  setDuckDBQuery: (query: DuckDBQueryState | null) => void
  setPGQuery: (query: PGQueryState | null) => void
  setIcebergPreview: (preview: IcebergPreviewState | null) => void
  setJupyterPreview: (preview: JupyterPreviewState | null) => void
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
  activeQGISPreview: null,
  activeGeoNodePreview: null,
  geonodeMapView: null,
  activeDuckDBQuery: null,
  activePGQuery: null,
  activeIcebergPreview: null,
  activeJupyterPreview: null,
  statusMessage: 'Ready',
  errorMessage: null,
  successMessage: null,
  isLoading: false,
  sidebarWidth: 400,
  settings: loadSettings(),

  openDialog: (type, data) => {
    set({ activeDialog: type, dialogData: data ?? null })
  },

  closeDialog: () => {
    set({ activeDialog: null, dialogData: null })
  },

  setPreview: (preview) => {
    // Clear all other previews when setting GeoServer preview
    set({ activePreview: preview, activeS3Preview: null, activeQGISPreview: null, activeGeoNodePreview: null, activeDuckDBQuery: null, activePGQuery: null, activeIcebergPreview: null, activeJupyterPreview: null })
  },

  setPreviewMode: (mode) => {
    set({ previewMode: mode })
  },

  setS3Preview: (preview) => {
    // Clear all other previews when setting S3 preview
    set({ activeS3Preview: preview, activePreview: null, activeQGISPreview: null, activeGeoNodePreview: null, activeDuckDBQuery: null, activePGQuery: null, activeIcebergPreview: null, activeJupyterPreview: null })
  },

  setQGISPreview: (preview) => {
    // Clear all other previews when setting QGIS preview
    set({ activeQGISPreview: preview, activePreview: null, activeS3Preview: null, activeGeoNodePreview: null, activeDuckDBQuery: null, activePGQuery: null, activeIcebergPreview: null, activeJupyterPreview: null })
  },

  setGeoNodePreview: (preview) => {
    // Clear all other previews when setting GeoNode preview
    // Clear map view only when closing the preview (preview is null)
    if (preview === null) {
      set({ activeGeoNodePreview: null, activePreview: null, activeS3Preview: null, activeQGISPreview: null, geonodeMapView: null, activeDuckDBQuery: null, activePGQuery: null, activeIcebergPreview: null, activeJupyterPreview: null })
    } else {
      set({ activeGeoNodePreview: preview, activePreview: null, activeS3Preview: null, activeQGISPreview: null, activeDuckDBQuery: null, activePGQuery: null, activeIcebergPreview: null, activeJupyterPreview: null })
    }
  },

  setGeoNodeMapView: (view) => {
    set({ geonodeMapView: view })
  },

  setDuckDBQuery: (query) => {
    // Clear all other previews when setting DuckDB query
    set({
      activeDuckDBQuery: query,
      activePreview: null,
      activeS3Preview: null,
      activeQGISPreview: null,
      activeGeoNodePreview: null,
      activePGQuery: null,
      activeIcebergPreview: null,
      activeJupyterPreview: null
    })
  },

  setPGQuery: (query) => {
    // Clear all other previews when setting PG query
    set({
      activePGQuery: query,
      activePreview: null,
      activeS3Preview: null,
      activeQGISPreview: null,
      activeGeoNodePreview: null,
      activeDuckDBQuery: null,
      activeIcebergPreview: null,
      activeJupyterPreview: null
    })
  },

  setIcebergPreview: (preview) => {
    // Clear all other previews when setting Iceberg preview
    set({
      activeIcebergPreview: preview,
      activePreview: null,
      activeS3Preview: null,
      activeQGISPreview: null,
      activeGeoNodePreview: null,
      activeDuckDBQuery: null,
      activePGQuery: null,
      activeJupyterPreview: null
    })
  },

  setJupyterPreview: (preview) => {
    // Clear all other previews when setting Jupyter preview
    set({
      activeJupyterPreview: preview,
      activePreview: null,
      activeS3Preview: null,
      activeQGISPreview: null,
      activeGeoNodePreview: null,
      activeDuckDBQuery: null,
      activePGQuery: null,
      activeIcebergPreview: null
    })
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

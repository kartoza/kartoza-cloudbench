import { create } from 'zustand'
import type { MapExplorerLayerRef } from '../utils/mapViewUrl'

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

// PMTiles/COG shown with the same map viewer Map Explorer uses, but inline
// in the main panel — triggered by clicking a pmtiles/web-mercator-cog
// object in the S3 connection tree.
interface S3MapPreviewState {
  connectionId: string
  bucketName: string
  objectKey: string
  format: 'pmtiles' | 'cog'
}

// A text-ish S3 object (README.md, collection.json, ...) shown formatted in
// the main panel — the component itself decides markdown/JSON/plain-text
// rendering from the object key's extension.
interface S3TextPreviewState {
  connectionId: string
  objectKey: string
  title: string
  size?: number
  lastModified?: string
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

  // Inline PMTiles/COG map preview (S3 connection tree)
  activeS3MapPreview: S3MapPreviewState | null

  // Inline markdown/JSON/text preview (S3 connection tree)
  activeS3TextPreview: S3TextPreviewState | null

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

  // A layer another part of the app wants Map Explorer to open with —
  // App.tsx watches this and opens the overlay when it's set.
  mapExplorerLayerRequest: MapExplorerLayerRef | null

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
  setS3MapPreview: (preview: S3MapPreviewState | null) => void
  setS3TextPreview: (preview: S3TextPreviewState | null) => void
  clearPreviews: () => void
  setQGISPreview: (preview: QGISPreviewState | null) => void
  setGeoNodePreview: (preview: GeoNodePreviewState | null) => void
  setGeoNodeMapView: (view: MapViewState | null) => void
  setDuckDBQuery: (query: DuckDBQueryState | null) => void
  setPGQuery: (query: PGQueryState | null) => void
  setIcebergPreview: (preview: IcebergPreviewState | null) => void
  setJupyterPreview: (preview: JupyterPreviewState | null) => void
  requestOpenMapExplorer: (layer: MapExplorerLayerRef) => void
  clearMapExplorerLayerRequest: () => void
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

// Every "active preview" slot, all null — the base every setter below
// spreads from so a new preview always replaces whichever one was showing.
const emptyPreviews = {
  activePreview: null,
  activeS3Preview: null,
  activeS3MapPreview: null,
  activeS3TextPreview: null,
  activeQGISPreview: null,
  activeGeoNodePreview: null,
  activeDuckDBQuery: null,
  activePGQuery: null,
  activeIcebergPreview: null,
  activeJupyterPreview: null,
}

export const useUIStore = create<UIState>((set) => ({
  activeDialog: null,
  dialogData: null,
  activePreview: null,
  previewMode: '2d',
  activeS3Preview: null,
  activeS3MapPreview: null,
  activeS3TextPreview: null,
  activeQGISPreview: null,
  activeGeoNodePreview: null,
  geonodeMapView: null,
  activeDuckDBQuery: null,
  activePGQuery: null,
  activeIcebergPreview: null,
  activeJupyterPreview: null,
  mapExplorerLayerRequest: null,
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
    set({ ...emptyPreviews, activePreview: preview })
  },

  setPreviewMode: (mode) => {
    set({ previewMode: mode })
  },

  setS3Preview: (preview) => {
    set({ ...emptyPreviews, activeS3Preview: preview })
  },

  setS3MapPreview: (preview) => {
    set({ ...emptyPreviews, activeS3MapPreview: preview })
  },

  setS3TextPreview: (preview) => {
    set({ ...emptyPreviews, activeS3TextPreview: preview })
  },

  clearPreviews: () => {
    set(emptyPreviews)
  },

  setQGISPreview: (preview) => {
    set({ ...emptyPreviews, activeQGISPreview: preview })
  },

  setGeoNodePreview: (preview) => {
    // Clear map view only when closing the preview (preview is null)
    set({ ...emptyPreviews, activeGeoNodePreview: preview, ...(preview === null ? { geonodeMapView: null } : {}) })
  },

  setGeoNodeMapView: (view) => {
    set({ geonodeMapView: view })
  },

  setDuckDBQuery: (query) => {
    set({ ...emptyPreviews, activeDuckDBQuery: query })
  },

  setPGQuery: (query) => {
    set({ ...emptyPreviews, activePGQuery: query })
  },

  setIcebergPreview: (preview) => {
    set({ ...emptyPreviews, activeIcebergPreview: preview })
  },

  setJupyterPreview: (preview) => {
    set({ ...emptyPreviews, activeJupyterPreview: preview })
  },

  requestOpenMapExplorer: (layer) => {
    set({ mapExplorerLayerRequest: layer })
  },

  clearMapExplorerLayerRequest: () => {
    set({ mapExplorerLayerRequest: null })
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

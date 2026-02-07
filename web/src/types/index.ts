// Connection types
export interface Connection {
  id: string
  name: string
  url: string
  username: string
  isActive: boolean
}

export interface ConnectionCreate {
  name: string
  url: string
  username: string
  password: string
}

export interface ServerInfo {
  GeoServerVersion: string
  GeoServerBuild: string
  GeoServerRevision: string
  GeoToolsVersion: string
  GeoWebCacheVersion: string
}

export interface TestConnectionResult {
  success: boolean
  message: string
  info?: ServerInfo
}

// Workspace types
export interface Workspace {
  name: string
  href?: string
  isolated?: boolean
}

export interface WorkspaceConfig {
  name: string
  isolated: boolean
  default: boolean
  enabled: boolean
  wmtsEnabled: boolean
  wmsEnabled: boolean
  wcsEnabled: boolean
  wpsEnabled: boolean
  wfsEnabled: boolean
}

// Store types
export interface DataStore {
  name: string
  type?: string
  enabled: boolean
  workspace: string
}

export interface CoverageStore {
  name: string
  type?: string
  enabled: boolean
  workspace: string
  description?: string
}

export interface DataStoreCreate {
  name: string
  type: string
  parameters: Record<string, string>
}

export interface CoverageStoreCreate {
  name: string
  type: string
  url: string
}

// Layer types
export interface Layer {
  name: string
  workspace: string
  store?: string
  storeType?: string
  type?: string
  enabled: boolean
  advertised?: boolean
  queryable?: boolean
  defaultStyle?: string
}

export interface LayerUpdate {
  enabled: boolean
  advertised: boolean
  queryable: boolean
}

// Style types
export interface Style {
  name: string
  workspace: string
  format?: string
}

// Layer Group types
export interface LayerGroup {
  name: string
  workspace: string
  mode?: string
}

// Feature Type and Coverage
export interface FeatureType {
  name: string
  workspace: string
  store: string
}

export interface Coverage {
  name: string
  workspace: string
  store: string
}

// Upload types
export interface UploadResult {
  success: boolean
  message: string
  storeName?: string
  storeType?: string
}

// Preview types
export interface PreviewRequest {
  connId: string
  workspace: string
  layerName: string
  storeName?: string
  storeType?: string
  layerType?: string
}

// Tree node types for UI
export type NodeType =
  | 'root'
  | 'connection'
  | 'workspace'
  | 'datastores'
  | 'coveragestores'
  | 'datastore'
  | 'coveragestore'
  | 'layers'
  | 'layer'
  | 'styles'
  | 'style'
  | 'layergroups'
  | 'layergroup'

export interface TreeNode {
  id: string
  name: string
  type: NodeType
  connectionId?: string
  workspace?: string
  storeName?: string
  storeType?: string
  children?: TreeNode[]
  isLoading?: boolean
  isLoaded?: boolean
  hasError?: boolean
  errorMsg?: string
  enabled?: boolean
}

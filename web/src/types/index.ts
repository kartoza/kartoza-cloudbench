// Connection types
export interface Connection {
  id: string
  name: string
  url: string
  username: string
  password: string
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

// Bounding Box type
export interface BoundingBox {
  minx: number
  miny: number
  maxx: number
  maxy: number
  crs?: string
}

// Metadata Link type
export interface MetadataLink {
  type: string
  metadataType: string
  content: string
}

// Comprehensive Layer Metadata
export interface LayerMetadata {
  name: string
  nativeName?: string
  workspace: string
  store: string
  storeType: 'datastore' | 'coveragestore'
  title?: string
  abstract?: string
  keywords?: string[]
  nativeCRS?: string
  srs?: string
  enabled: boolean
  advertised: boolean
  queryable: boolean
  nativeBoundingBox?: BoundingBox
  latLonBoundingBox?: BoundingBox
  attributionTitle?: string
  attributionHref?: string
  attributionLogo?: string
  metadataLinks?: MetadataLink[]
  defaultStyle?: string
  maxFeatures?: number
  numDecimals?: number
}

// Layer Metadata Update Request
export interface LayerMetadataUpdate {
  title?: string
  abstract?: string
  keywords?: string[]
  srs?: string
  enabled?: boolean
  advertised?: boolean
  queryable?: boolean
  attributionTitle?: string
  attributionHref?: string
  metadataLinks?: MetadataLink[]
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

export interface LayerGroupCreate {
  name: string
  title?: string
  mode?: 'SINGLE' | 'NAMED' | 'CONTAINER' | 'EO'
  layers: string[] // Layer names in workspace:layer format
}

export interface LayerGroupDetails {
  name: string
  workspace: string
  mode: string
  title?: string
  abstract?: string
  layers: LayerGroupItem[]
  bounds?: Bounds
  enabled: boolean
  advertised: boolean
}

export interface LayerGroupItem {
  type: string // 'layer' or 'layerGroup'
  name: string
  styleName?: string
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  crs: string
}

export interface LayerGroupUpdate {
  title?: string
  mode?: string
  layers?: string[]
  enabled?: boolean
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
  layerType?: string // 'vector', 'raster', or 'group'
  useCache?: boolean // If true, use WMTS (cached tiles) instead of WMS
  gridSet?: string // WMTS grid set (e.g., "EPSG:900913", "EPSG:4326")
  tileFormat?: string // WMTS tile format (e.g., "image/png")
}

// Tree node types for UI
export type NodeType =
  | 'root'
  | 'cloudbench'     // Application root: "Kartoza CloudBench"
  | 'geoserver'      // "GeoServer" container
  | 'postgresql'     // "PostgreSQL" container
  | 's3storage'      // "S3 Storage" container
  | 'connection'     // GeoServer connection
  | 'pgservice'      // pg_service.conf entry
  | 'pgschema'       // PostgreSQL schema
  | 'pgtable'        // Database table
  | 'pgview'         // Database view
  | 'pgcolumn'       // Table column
  | 's3connection'   // S3 storage connection
  | 's3bucket'       // S3 bucket
  | 's3folder'       // Virtual folder (prefix) in S3
  | 's3object'       // S3 object (file)
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
  // PostgreSQL-specific fields
  serviceName?: string
  schemaName?: string
  tableName?: string
  isParsed?: boolean
  dataType?: string
  // S3-specific fields
  s3ConnectionId?: string
  s3Bucket?: string
  s3Key?: string
  s3Size?: number
  s3ContentType?: string
  s3IsFolder?: boolean
}

// GeoWebCache (GWC) types
export interface GWCLayer {
  name: string
  enabled: boolean
  gridSubsets?: string[]
  mimeFormats?: string[]
}

export interface GWCSeedRequest {
  gridSetId: string
  zoomStart: number
  zoomStop: number
  format: string
  type: 'seed' | 'reseed' | 'truncate'
  threadCount: number
  bounds?: GWCBounds
}

export interface GWCBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  srs: string
}

export interface GWCSeedTask {
  id: number
  tilesDone: number
  tilesTotal: number
  timeRemaining: number
  status: 'Pending' | 'Running' | 'Done' | 'Aborted' | 'Unknown'
  layerName: string
  progress: number // 0-100
}

export interface GWCGridSet {
  name: string
  srs?: string
  tileWidth?: number
  tileHeight?: number
  minX?: number
  minY?: number
  maxX?: number
  maxY?: number
}

export interface GWCDiskQuota {
  enabled: boolean
  diskBlockSize: number
  cacheCleanUpFrequency: number
  maxConcurrentCleanUps: number
  globalQuota?: string
}

// GeoServer Contact/Settings types
export interface GeoServerContact {
  contactPerson?: string
  contactPosition?: string
  contactOrganization?: string
  addressType?: string
  address?: string
  addressCity?: string
  addressState?: string
  addressPostalCode?: string
  addressCountry?: string
  contactVoice?: string
  contactFacsimile?: string
  contactEmail?: string
  onlineResource?: string
  welcome?: string
}

// Sync types
export type DataStoreSyncStrategy = 'same_connection' | 'geopackage_copy' | 'skip'

export interface SyncOptions {
  workspaces: boolean
  datastores: boolean
  coveragestores: boolean
  layers: boolean
  styles: boolean
  layergroups: boolean
  workspace_filter?: string[]
  datastore_strategy?: DataStoreSyncStrategy
}

export interface SyncConfiguration {
  id: string
  name: string
  source_id: string
  destination_ids: string[]
  options: SyncOptions
  created_at: string
  last_synced_at?: string
}

export interface SyncTask {
  id: string
  configId: string
  sourceId: string
  destId: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  progress: number
  currentItem: string
  itemsTotal: number
  itemsDone: number
  itemsSkipped: number
  itemsFailed: number
  startedAt: string
  completedAt?: string
  error?: string
  log: string[]
}

export interface StartSyncRequest {
  configId?: string
  sourceId?: string
  destinationIds?: string[]
  options?: SyncOptions
}

// Dashboard types
export interface ServerStatus {
  connectionId: string
  connectionName: string
  url: string
  online: boolean
  responseTimeMs: number
  memoryUsed: number
  memoryFree: number
  memoryTotal: number
  memoryUsedPct: number
  cpuLoad: number
  workspaceCount: number
  layerCount: number
  dataStoreCount: number
  coverageCount: number
  styleCount: number
  error?: string
  geoserverVersion?: string
}

export interface DashboardData {
  servers: ServerStatus[]
  onlineCount: number
  offlineCount: number
  totalLayers: number
  totalStores: number
  alertServers: ServerStatus[]
  pingIntervalSecs: number // Dashboard refresh interval from settings
}

// ============================================================================
// S3 Storage Types
// ============================================================================

// S3 Connection configuration
export interface S3Connection {
  id: string
  name: string
  endpoint: string
  accessKey: string
  secretKey: string
  region?: string
  useSSL: boolean
  pathStyle: boolean
  isActive: boolean
}

export interface S3ConnectionCreate {
  name: string
  endpoint: string
  accessKey: string
  secretKey: string
  region?: string
  useSSL: boolean
  pathStyle: boolean
}

export interface S3ConnectionTestResult {
  success: boolean
  message: string
  buckets?: number
}

// S3 Bucket
export interface S3Bucket {
  name: string
  creationDate: string
}

// S3 Object
export interface S3Object {
  key: string
  size: number
  lastModified: string
  contentType?: string
  isFolder: boolean
  etag?: string
}

// Cloud-native format types
export type CloudNativeFormat = 'cog' | 'copc' | 'geoparquet' | 'parquet' | 'unknown'

// Conversion job status
export type ConversionJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

// Conversion job
export interface ConversionJob {
  id: string
  sourcePath: string
  outputPath: string
  sourceFormat: string
  targetFormat: string
  status: ConversionJobStatus
  progress: number
  message: string
  error?: string
  startedAt: string
  completedAt?: string
  inputSize: number
  outputSize?: number
}

// Conversion tool info
export interface ConversionToolInfo {
  available: boolean
  version?: string
  tool: string
  formats?: string[]
  error?: string
}

export interface ConversionToolStatus {
  gdal?: ConversionToolInfo
  pdal?: ConversionToolInfo
  ogr2ogr?: ConversionToolInfo
}

// S3 Upload options
export interface S3UploadOptions {
  convert?: boolean // Whether to suggest/perform cloud-native conversion
  targetFormat?: 'cog' | 'copc' | 'geoparquet'
}

// S3 Upload result
export interface S3UploadResult {
  success: boolean
  message: string
  key: string
  size: number
  conversionJobId?: string // If conversion was started
}

// S3 Preview metadata for layer preview
export interface S3PreviewBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface S3PreviewMetadata {
  format: string  // "cog", "copc", "geoparquet", "geojson", "geotiff"
  previewType: string  // "raster", "pointcloud", "vector"
  bounds?: S3PreviewBounds
  crs?: string
  size: number
  key: string
  proxyUrl: string  // URL to proxy through backend (not direct S3 access)
  bandCount?: number  // Number of bands in raster (1 = potential DEM)
  metadata?: unknown
}

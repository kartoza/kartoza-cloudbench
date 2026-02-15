import type {
  Connection,
  ConnectionCreate,
  TestConnectionResult,
  ServerInfo,
  Workspace,
  WorkspaceConfig,
  DataStore,
  CoverageStore,
  DataStoreCreate,
  CoverageStoreCreate,
  Layer,
  LayerUpdate,
  LayerMetadata,
  LayerMetadataUpdate,
  Style,
  LayerGroup,
  LayerGroupCreate,
  LayerGroupDetails,
  LayerGroupUpdate,
  FeatureType,
  Coverage,
  UploadResult,
  PreviewRequest,
  GWCLayer,
  GWCSeedRequest,
  GWCSeedTask,
  GWCGridSet,
  GWCDiskQuota,
  GeoServerContact,
  SyncConfiguration,
  SyncTask,
  StartSyncRequest,
  DashboardData,
  ServerStatus,
} from '../types'

const API_BASE = '/api'

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json()
}

// Connection API
export async function getConnections(): Promise<Connection[]> {
  const response = await fetch(`${API_BASE}/connections`)
  return handleResponse<Connection[]>(response)
}

export async function getConnection(id: string): Promise<Connection> {
  const response = await fetch(`${API_BASE}/connections/${id}`)
  return handleResponse<Connection>(response)
}

export async function createConnection(conn: ConnectionCreate): Promise<Connection> {
  const response = await fetch(`${API_BASE}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<Connection>(response)
}

export async function updateConnection(id: string, conn: Partial<ConnectionCreate>): Promise<Connection> {
  const response = await fetch(`${API_BASE}/connections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<Connection>(response)
}

export async function deleteConnection(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/connections/${id}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

export async function testConnection(id: string): Promise<TestConnectionResult> {
  const response = await fetch(`${API_BASE}/connections/${id}/test`, {
    method: 'POST',
  })
  return handleResponse<TestConnectionResult>(response)
}

export async function getServerInfo(id: string): Promise<ServerInfo> {
  const response = await fetch(`${API_BASE}/connections/${id}/info`)
  return handleResponse<ServerInfo>(response)
}

// Workspace API
export async function getWorkspaces(connId: string): Promise<Workspace[]> {
  const response = await fetch(`${API_BASE}/workspaces/${connId}`)
  return handleResponse<Workspace[]>(response)
}

export async function getWorkspace(connId: string, name: string): Promise<WorkspaceConfig> {
  const response = await fetch(`${API_BASE}/workspaces/${connId}/${name}`)
  return handleResponse<WorkspaceConfig>(response)
}

export async function createWorkspace(connId: string, config: WorkspaceConfig): Promise<Workspace> {
  const response = await fetch(`${API_BASE}/workspaces/${connId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return handleResponse<Workspace>(response)
}

export async function updateWorkspace(connId: string, name: string, config: WorkspaceConfig): Promise<WorkspaceConfig> {
  const response = await fetch(`${API_BASE}/workspaces/${connId}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return handleResponse<WorkspaceConfig>(response)
}

export async function deleteWorkspace(connId: string, name: string, recurse = false): Promise<void> {
  const params = recurse ? '?recurse=true' : ''
  const response = await fetch(`${API_BASE}/workspaces/${connId}/${name}${params}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Data Store API
export async function getDataStores(connId: string, workspace: string): Promise<DataStore[]> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}`)
  return handleResponse<DataStore[]>(response)
}

export async function getDataStore(connId: string, workspace: string, name: string): Promise<DataStore> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${name}`)
  return handleResponse<DataStore>(response)
}

export async function createDataStore(connId: string, workspace: string, store: DataStoreCreate): Promise<DataStore> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store),
  })
  return handleResponse<DataStore>(response)
}

export async function deleteDataStore(connId: string, workspace: string, name: string, recurse = false): Promise<void> {
  const params = recurse ? '?recurse=true' : ''
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${name}${params}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Get available (unpublished) feature types in a data store
export async function getAvailableFeatureTypes(connId: string, workspace: string, store: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${store}/available`)
  const result = await handleResponse<{ available: string[] }>(response)
  return result.available || []
}

// Publish feature types from a data store
export async function publishFeatureTypes(
  connId: string,
  workspace: string,
  store: string,
  featureTypes: string[]
): Promise<{ published: string[]; errors: string[] }> {
  const response = await fetch(`${API_BASE}/datastores/${connId}/${workspace}/${store}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ featureTypes }),
  })
  return handleResponse<{ published: string[]; errors: string[] }>(response)
}

// Coverage Store API
export async function getCoverageStores(connId: string, workspace: string): Promise<CoverageStore[]> {
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}`)
  return handleResponse<CoverageStore[]>(response)
}

export async function getCoverageStore(connId: string, workspace: string, name: string): Promise<CoverageStore> {
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}/${name}`)
  return handleResponse<CoverageStore>(response)
}

export async function createCoverageStore(connId: string, workspace: string, store: CoverageStoreCreate): Promise<CoverageStore> {
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store),
  })
  return handleResponse<CoverageStore>(response)
}

export async function deleteCoverageStore(connId: string, workspace: string, name: string, recurse = false): Promise<void> {
  const params = recurse ? '?recurse=true' : ''
  const response = await fetch(`${API_BASE}/coveragestores/${connId}/${workspace}/${name}${params}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Layer API
export async function getLayers(connId: string, workspace: string): Promise<Layer[]> {
  const response = await fetch(`${API_BASE}/layers/${connId}/${workspace}`)
  return handleResponse<Layer[]>(response)
}

export async function getLayer(connId: string, workspace: string, name: string): Promise<Layer> {
  const response = await fetch(`${API_BASE}/layers/${connId}/${workspace}/${name}`)
  return handleResponse<Layer>(response)
}

export async function updateLayer(connId: string, workspace: string, name: string, update: LayerUpdate): Promise<Layer> {
  const response = await fetch(`${API_BASE}/layers/${connId}/${workspace}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  return handleResponse<Layer>(response)
}

export async function deleteLayer(connId: string, workspace: string, name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/layers/${connId}/${workspace}/${name}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Layer Metadata API (comprehensive metadata)
export async function getLayerFullMetadata(connId: string, workspace: string, name: string): Promise<LayerMetadata> {
  const response = await fetch(`${API_BASE}/layermetadata/${connId}/${workspace}/${name}`)
  return handleResponse<LayerMetadata>(response)
}

// Feature count for vector layers
export async function getLayerFeatureCount(connId: string, workspace: string, name: string): Promise<number> {
  const response = await fetch(`${API_BASE}/layers/${connId}/${workspace}/${name}/count`)
  const data = await handleResponse<{ count: number }>(response)
  return data.count
}

export async function updateLayerMetadata(
  connId: string,
  workspace: string,
  name: string,
  update: LayerMetadataUpdate
): Promise<LayerMetadata> {
  const response = await fetch(`${API_BASE}/layermetadata/${connId}/${workspace}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  return handleResponse<LayerMetadata>(response)
}

// Style API
export async function getStyles(connId: string, workspace: string): Promise<Style[]> {
  const response = await fetch(`${API_BASE}/styles/${connId}/${workspace}`)
  return handleResponse<Style[]>(response)
}

export async function deleteStyle(connId: string, workspace: string, name: string, purge = false): Promise<void> {
  const params = purge ? '?purge=true' : ''
  const response = await fetch(`${API_BASE}/styles/${connId}/${workspace}/${name}${params}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Layer styles association
export interface LayerStyles {
  defaultStyle: string
  additionalStyles: string[]
}

export async function getLayerStyles(connId: string, workspace: string, layer: string): Promise<LayerStyles> {
  const response = await fetch(`${API_BASE}/layerstyles/${connId}/${workspace}/${layer}`)
  return handleResponse<LayerStyles>(response)
}

export async function updateLayerStyles(
  connId: string,
  workspace: string,
  layer: string,
  defaultStyle: string,
  additionalStyles: string[]
): Promise<LayerStyles> {
  const response = await fetch(`${API_BASE}/layerstyles/${connId}/${workspace}/${layer}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultStyle, additionalStyles }),
  })
  return handleResponse<LayerStyles>(response)
}

// Style content for editor
export interface StyleContent {
  name: string
  workspace: string
  format: 'sld' | 'css' | 'mbstyle'
  content: string
}

export async function getStyleContent(connId: string, workspace: string, name: string): Promise<StyleContent> {
  const response = await fetch(`${API_BASE}/styles/${connId}/${workspace}/${name}`)
  return handleResponse<StyleContent>(response)
}

export async function updateStyleContent(
  connId: string,
  workspace: string,
  name: string,
  content: string,
  format: 'sld' | 'css' | 'mbstyle' = 'sld'
): Promise<StyleContent> {
  const response = await fetch(`${API_BASE}/styles/${connId}/${workspace}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, format }),
  })
  return handleResponse<StyleContent>(response)
}

export async function createStyle(
  connId: string,
  workspace: string,
  name: string,
  content: string,
  format: 'sld' | 'css' | 'mbstyle' = 'sld'
): Promise<StyleContent> {
  const response = await fetch(`${API_BASE}/styles/${connId}/${workspace}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content, format }),
  })
  return handleResponse<StyleContent>(response)
}

// Layer Group API
export async function getLayerGroups(connId: string, workspace: string): Promise<LayerGroup[]> {
  const response = await fetch(`${API_BASE}/layergroups/${connId}/${workspace}`)
  return handleResponse<LayerGroup[]>(response)
}

export async function createLayerGroup(
  connId: string,
  workspace: string,
  config: LayerGroupCreate
): Promise<LayerGroup> {
  const response = await fetch(`${API_BASE}/layergroups/${connId}/${workspace}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return handleResponse<LayerGroup>(response)
}

export async function getLayerGroup(
  connId: string,
  workspace: string,
  name: string
): Promise<LayerGroupDetails> {
  const response = await fetch(`${API_BASE}/layergroups/${connId}/${workspace}/${name}`)
  return handleResponse<LayerGroupDetails>(response)
}

export async function updateLayerGroup(
  connId: string,
  workspace: string,
  name: string,
  update: LayerGroupUpdate
): Promise<LayerGroupDetails> {
  const response = await fetch(`${API_BASE}/layergroups/${connId}/${workspace}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  return handleResponse<LayerGroupDetails>(response)
}

export async function deleteLayerGroup(connId: string, workspace: string, name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/layergroups/${connId}/${workspace}/${name}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Feature Type API
export async function getFeatureTypes(connId: string, workspace: string, store: string): Promise<FeatureType[]> {
  const response = await fetch(`${API_BASE}/featuretypes/${connId}/${workspace}/${store}`)
  return handleResponse<FeatureType[]>(response)
}

export async function publishFeatureType(connId: string, workspace: string, store: string, name: string): Promise<FeatureType> {
  const response = await fetch(`${API_BASE}/featuretypes/${connId}/${workspace}/${store}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return handleResponse<FeatureType>(response)
}

// Coverage API
export async function getCoverages(connId: string, workspace: string, store: string): Promise<Coverage[]> {
  const response = await fetch(`${API_BASE}/coverages/${connId}/${workspace}/${store}`)
  return handleResponse<Coverage[]>(response)
}

export async function publishCoverage(connId: string, workspace: string, store: string, name: string): Promise<Coverage> {
  const response = await fetch(`${API_BASE}/coverages/${connId}/${workspace}/${store}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return handleResponse<Coverage>(response)
}

// Upload API
export async function uploadFile(
  connId: string,
  workspace: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<UploadResult> {
  const formData = new FormData()
  formData.append('file', file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100)
        onProgress(progress)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'))
    })

    xhr.open('POST', `${API_BASE}/upload?connId=${encodeURIComponent(connId)}&workspace=${encodeURIComponent(workspace)}`)
    xhr.send(formData)
  })
}

// Preview API
export async function startPreview(request: PreviewRequest): Promise<{ url: string }> {
  const response = await fetch(`${API_BASE}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return handleResponse<{ url: string }>(response)
}

export async function getLayerInfo(): Promise<PreviewRequest> {
  const response = await fetch(`${API_BASE}/layer`)
  return handleResponse<PreviewRequest>(response)
}

export async function getLayerMetadata(): Promise<{ bounds: number[] }> {
  const response = await fetch(`${API_BASE}/metadata`)
  return handleResponse<{ bounds: number[] }>(response)
}

// ============================================================================
// GeoWebCache (GWC) API
// ============================================================================

// Get all cached layers
export async function getGWCLayers(connId: string): Promise<GWCLayer[]> {
  const response = await fetch(`${API_BASE}/gwc/layers/${connId}`)
  return handleResponse<GWCLayer[]>(response)
}

// Get details for a specific cached layer
export async function getGWCLayer(connId: string, layerName: string): Promise<GWCLayer> {
  const response = await fetch(`${API_BASE}/gwc/layers/${connId}/${layerName}`)
  return handleResponse<GWCLayer>(response)
}

// Get seed status for a layer
export async function getGWCSeedStatus(connId: string, layerName: string): Promise<GWCSeedTask[]> {
  const response = await fetch(`${API_BASE}/gwc/seed/${connId}/${layerName}`)
  return handleResponse<GWCSeedTask[]>(response)
}

// Start a seed/reseed/truncate operation
export async function seedLayer(
  connId: string,
  layerName: string,
  request: GWCSeedRequest
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/gwc/seed/${connId}/${layerName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// Terminate seed tasks for a specific layer
export async function terminateLayerSeed(
  connId: string,
  layerName: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/gwc/seed/${connId}/${layerName}`, {
    method: 'DELETE',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// Terminate all seed tasks
export async function terminateAllSeeds(
  connId: string,
  killType: 'running' | 'pending' | 'all' = 'all'
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/gwc/seed/${connId}?type=${killType}`, {
    method: 'DELETE',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// Truncate all cached tiles for a layer
export async function truncateLayer(
  connId: string,
  layerName: string,
  options?: {
    gridSetId?: string
    format?: string
    zoomStart?: number
    zoomStop?: number
  }
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/gwc/truncate/${connId}/${layerName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {}),
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// Get all available grid sets
export async function getGWCGridSets(connId: string): Promise<GWCGridSet[]> {
  const response = await fetch(`${API_BASE}/gwc/gridsets/${connId}`)
  return handleResponse<GWCGridSet[]>(response)
}

// Get details for a specific grid set
export async function getGWCGridSet(connId: string, name: string): Promise<GWCGridSet> {
  const response = await fetch(`${API_BASE}/gwc/gridsets/${connId}/${name}`)
  return handleResponse<GWCGridSet>(response)
}

// Get disk quota configuration
export async function getGWCDiskQuota(connId: string): Promise<GWCDiskQuota> {
  const response = await fetch(`${API_BASE}/gwc/diskquota/${connId}`)
  return handleResponse<GWCDiskQuota>(response)
}

// Update disk quota configuration
export async function updateGWCDiskQuota(
  connId: string,
  quota: Partial<GWCDiskQuota>
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/gwc/diskquota/${connId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quota),
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// ============================================================================
// GeoServer Settings/Contact API
// ============================================================================

// Get GeoServer contact information
export async function getContact(connId: string): Promise<GeoServerContact> {
  const response = await fetch(`${API_BASE}/settings/${connId}`)
  return handleResponse<GeoServerContact>(response)
}

// Update GeoServer contact information
export async function updateContact(
  connId: string,
  contact: GeoServerContact
): Promise<GeoServerContact> {
  const response = await fetch(`${API_BASE}/settings/${connId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contact),
  })
  return handleResponse<GeoServerContact>(response)
}

// ============================================================================
// Server Sync API
// ============================================================================

// Get all sync configurations
export async function getSyncConfigs(): Promise<SyncConfiguration[]> {
  const response = await fetch(`${API_BASE}/sync/configs`)
  return handleResponse<SyncConfiguration[]>(response)
}

// Get a specific sync configuration
export async function getSyncConfig(id: string): Promise<SyncConfiguration> {
  const response = await fetch(`${API_BASE}/sync/configs/${id}`)
  return handleResponse<SyncConfiguration>(response)
}

// Create a new sync configuration
export async function createSyncConfig(
  config: Omit<SyncConfiguration, 'id' | 'created_at'>
): Promise<SyncConfiguration> {
  const response = await fetch(`${API_BASE}/sync/configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return handleResponse<SyncConfiguration>(response)
}

// Update an existing sync configuration
export async function updateSyncConfig(
  id: string,
  config: Partial<SyncConfiguration>
): Promise<SyncConfiguration> {
  const response = await fetch(`${API_BASE}/sync/configs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return handleResponse<SyncConfiguration>(response)
}

// Delete a sync configuration
export async function deleteSyncConfig(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sync/configs/${id}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Start a sync operation
export async function startSync(request: StartSyncRequest): Promise<SyncTask[]> {
  const response = await fetch(`${API_BASE}/sync/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return handleResponse<SyncTask[]>(response)
}

// Get status of all running sync tasks
export async function getSyncStatus(): Promise<SyncTask[]> {
  const response = await fetch(`${API_BASE}/sync/status`)
  return handleResponse<SyncTask[]>(response)
}

// Get status of a specific sync task
export async function getSyncTaskStatus(taskId: string): Promise<SyncTask> {
  const response = await fetch(`${API_BASE}/sync/status/${taskId}`)
  return handleResponse<SyncTask>(response)
}

// Stop a specific sync task
export async function stopSyncTask(taskId: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/sync/stop/${taskId}`, {
    method: 'POST',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// Stop all running sync tasks
export async function stopAllSyncs(): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/sync/stop`, {
    method: 'POST',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// ============================================================================
// Dashboard API
// ============================================================================

// Get dashboard data (all servers status)
export async function getDashboard(): Promise<DashboardData> {
  const response = await fetch(`${API_BASE}/dashboard`)
  return handleResponse<DashboardData>(response)
}

// Get status for a single server
export async function getServerStatus(connectionId: string): Promise<ServerStatus> {
  const response = await fetch(`${API_BASE}/dashboard/server?id=${connectionId}`)
  return handleResponse<ServerStatus>(response)
}

// ============================================================================
// Download API - Export resource configurations
// ============================================================================

export type DownloadResourceType = 'workspace' | 'datastore' | 'coveragestore' | 'layer' | 'style' | 'layergroup'
export type DownloadDataType = 'shapefile' | 'geotiff'

// Download a resource configuration (triggers browser file download)
export function downloadResource(
  connectionId: string,
  resourceType: DownloadResourceType,
  workspace: string,
  name?: string
): void {
  let url = `${API_BASE}/download/${connectionId}/${resourceType}/${workspace}`
  if (name) {
    url += `/${name}`
  }
  // Trigger browser download
  window.open(url, '_blank')
}

// Download layer data as shapefile (triggers browser file download)
export function downloadShapefile(
  connectionId: string,
  workspace: string,
  layerName: string
): void {
  const url = `${API_BASE}/download/${connectionId}/shapefile/${workspace}/${layerName}`
  window.open(url, '_blank')
}

// Download coverage data as GeoTIFF (triggers browser file download)
export function downloadGeoTiff(
  connectionId: string,
  workspace: string,
  coverageName: string
): void {
  const url = `${API_BASE}/download/${connectionId}/geotiff/${workspace}/${coverageName}`
  window.open(url, '_blank')
}

// Download sync task logs (triggers browser file download)
export function downloadSyncLogs(taskId: string): void {
  const url = `${API_BASE}/download/logs/${taskId}`
  window.open(url, '_blank')
}

// ============================================================================
// Universal Search API
// ============================================================================

export interface SearchResult {
  type: 'workspace' | 'datastore' | 'coveragestore' | 'layer' | 'style' | 'layergroup'
  name: string
  workspace?: string
  storeName?: string
  storeType?: string
  connectionId: string
  serverName: string
  tags: string[]
  description?: string
  icon: string
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}

// Search across all connections and resources
export async function search(query: string, connectionId?: string): Promise<SearchResponse> {
  let url = `${API_BASE}/search?q=${encodeURIComponent(query)}`
  if (connectionId) {
    url += `&connection=${encodeURIComponent(connectionId)}`
  }
  const response = await fetch(url)
  return handleResponse<SearchResponse>(response)
}

// Get search suggestions
export async function getSearchSuggestions(): Promise<{ suggestions: string[] }> {
  const response = await fetch(`${API_BASE}/search/suggestions`)
  return handleResponse<{ suggestions: string[] }>(response)
}

// ============================================================================
// PostgreSQL Services API (from pg_service.conf)
// ============================================================================

export interface PGService {
  name: string
  host?: string
  port?: string
  dbname?: string
  user?: string
  sslmode?: string
  is_parsed: boolean
}

export interface PGServiceCreate {
  name: string
  host: string
  port: string
  dbname: string
  user: string
  password: string
  sslmode: string
}

// Get all PostgreSQL services from pg_service.conf
export async function getPGServices(): Promise<PGService[]> {
  const response = await fetch(`${API_BASE}/pg/services`)
  return handleResponse<PGService[]>(response)
}

// Create a new PostgreSQL service (adds to pg_service.conf)
export async function createPGService(service: PGServiceCreate): Promise<PGService> {
  const response = await fetch(`${API_BASE}/pg/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(service),
  })
  return handleResponse<PGService>(response)
}

// Delete a PostgreSQL service from pg_service.conf
export async function deletePGService(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

// Test a PostgreSQL service connection
export async function testPGService(name: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}/test`, {
    method: 'POST',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// Parse/harvest schema from a PostgreSQL service
export async function parsePGService(name: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}/parse`, {
    method: 'POST',
  })
  return handleResponse<unknown>(response)
}

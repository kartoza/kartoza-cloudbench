/**
 * Client API - Additional APIs not yet modularized
 *
 * Core APIs have been split into separate modules:
 * - connection.ts - GeoServer connection API
 * - workspace.ts - Workspace API
 * - stores.ts - DataStore and CoverageStore API
 * - layer.ts - Layer, FeatureType, Coverage API
 * - style.ts - Style API
 * - layergroup.ts - Layer Group API
 * - s3.ts - S3 Storage API
 * - iceberg.ts - Apache Iceberg API
 *
 * This file contains APIs that haven't been split yet:
 * - Upload API
 * - Preview API
 * - GWC (GeoWebCache) API
 * - Settings/Contact API
 * - Sync API
 * - Dashboard API
 * - Download API
 * - Search API
 * - PostgreSQL API
 * - QGIS API
 * - GeoNode API
 */

import { API_BASE, handleResponse } from './common'
import type {
  ConversionJob,
  ConversionToolStatus,
  DashboardData,
  GeoNodeConnection,
  GeoNodeConnectionCreate,
  GeoNodeDashboardsResponse,
  GeoNodeDatasetsResponse,
  GeoNodeDocumentsResponse,
  GeoNodeGeoStoriesResponse,
  GeoNodeHarvestResourcesResponse,
  GeoNodeMapsResponse,
  GeoNodeRemoteServicesResponse,
  GeoNodeResourcesResponse,
  GeoNodeTestResult,
  GeoServerContact,
  GWCDiskQuota,
  GWCGridSet,
  GWCLayer,
  GWCSeedRequest,
  GWCSeedTask,
  MerginMapsConnection,
  MerginMapsConnectionCreate,
  MerginMapsProjectsResponse,
  MerginMapsTestResult,
  PreviewRequest,
  QFieldCloudCollaborator,
  QFieldCloudCollaboratorCreate,
  QFieldCloudConnection,
  QFieldCloudConnectionCreate,
  QFieldCloudDelta,
  QFieldCloudFile,
  QFieldCloudJob,
  QFieldCloudJobCreate,
  QFieldCloudProject,
  QFieldCloudProjectCreate,
  QFieldCloudProjectUpdate,
  QFieldCloudTestResult,
  QGISProject,
  QGISProjectCreate,
  ServerStatus,
  StartSyncRequest,
  SyncConfiguration,
  SyncTask,
  UploadResult,
} from '../types'
import { getApiBase } from "../config/env.ts";

// ============================================================================
// Upload API
// ============================================================================

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

// ============================================================================
// Preview API
// ============================================================================

export async function startPreview(request: PreviewRequest): Promise<{
  url: string
}> {
  const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || ''
  const response = await fetch(`${API_BASE}/preview/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken,
    },
    credentials: 'include',
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

export async function getGWCLayers(connId: string): Promise<GWCLayer[]> {
  const response = await fetch(`${API_BASE}/gwc/layers/${connId}`)
  return handleResponse<GWCLayer[]>(response)
}

export async function getGWCLayer(connId: string, layerName: string): Promise<GWCLayer> {
  const response = await fetch(`${API_BASE}/gwc/layers/${connId}/${layerName}`)
  return handleResponse<GWCLayer>(response)
}

export async function getGWCSeedStatus(connId: string, layerName: string): Promise<GWCSeedTask[]> {
  const response = await fetch(`${API_BASE}/gwc/seed/${connId}/${layerName}`)
  return handleResponse<GWCSeedTask[]>(response)
}

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

export async function terminateLayerSeed(
  connId: string,
  layerName: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/gwc/seed/${connId}/${layerName}`, {
    method: 'DELETE',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

export async function terminateAllSeeds(
  connId: string,
  killType: 'running' | 'pending' | 'all' = 'all'
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/gwc/seed/${connId}?type=${killType}`, {
    method: 'DELETE',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

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

export async function getGWCGridSets(connId: string): Promise<GWCGridSet[]> {
  const response = await fetch(`${API_BASE}/gwc/gridsets/${connId}`)
  return handleResponse<GWCGridSet[]>(response)
}

export async function getGWCGridSet(connId: string, name: string): Promise<GWCGridSet> {
  const response = await fetch(`${API_BASE}/gwc/gridsets/${connId}/${name}`)
  return handleResponse<GWCGridSet>(response)
}

export async function getGWCDiskQuota(connId: string): Promise<GWCDiskQuota> {
  const response = await fetch(`${API_BASE}/gwc/diskquota/${connId}`)
  return handleResponse<GWCDiskQuota>(response)
}

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

export async function getContact(connId: string): Promise<GeoServerContact> {
  const response = await fetch(`${API_BASE}/settings/${connId}`)
  return handleResponse<GeoServerContact>(response)
}

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

export async function getSyncConfigs(): Promise<SyncConfiguration[]> {
  const response = await fetch(`${API_BASE}/sync/configs`)
  return handleResponse<SyncConfiguration[]>(response)
}

export async function getSyncConfig(id: string): Promise<SyncConfiguration> {
  const response = await fetch(`${API_BASE}/sync/configs/${id}`)
  return handleResponse<SyncConfiguration>(response)
}

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

export async function deleteSyncConfig(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sync/configs/${id}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

export async function startSync(request: StartSyncRequest): Promise<SyncTask[]> {
  const response = await fetch(`${API_BASE}/sync/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return handleResponse<SyncTask[]>(response)
}

export async function getSyncStatus(): Promise<SyncTask[]> {
  const response = await fetch(`${API_BASE}/sync/status`)
  return handleResponse<SyncTask[]>(response)
}

export async function getSyncTaskStatus(taskId: string): Promise<SyncTask> {
  const response = await fetch(`${API_BASE}/sync/status/${taskId}`)
  return handleResponse<SyncTask>(response)
}

export async function stopSyncTask(taskId: string): Promise<{
  success: boolean;
  message: string
}> {
  const response = await fetch(`${API_BASE}/sync/stop/${taskId}`, {
    method: 'POST',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

export async function stopAllSyncs(): Promise<{
  success: boolean;
  message: string
}> {
  const response = await fetch(`${API_BASE}/sync/stop`, {
    method: 'POST',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// ============================================================================
// Dashboard API
// ============================================================================

export async function getDashboard(): Promise<DashboardData> {
  const response = await fetch(`${API_BASE}/dashboard`)
  return handleResponse<DashboardData>(response)
}

export async function getServerStatus(connectionId: string): Promise<ServerStatus> {
  const response = await fetch(`${API_BASE}/dashboard/server?id=${connectionId}`)
  return handleResponse<ServerStatus>(response)
}

// ============================================================================
// Download API - Export resource configurations
// ============================================================================

export type DownloadResourceType =
  'workspace'
  | 'datastore'
  | 'coveragestore'
  | 'layer'
  | 'style'
  | 'layergroup'
export type DownloadDataType = 'shapefile' | 'geotiff'

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
  window.open(url, '_blank')
}

export function downloadShapefile(
  connectionId: string,
  workspace: string,
  layerName: string
): void {
  const url = `${API_BASE}/download/${connectionId}/shapefile/${workspace}/${layerName}`
  window.open(url, '_blank')
}

export function downloadGeoTiff(
  connectionId: string,
  workspace: string,
  coverageName: string
): void {
  const url = `${API_BASE}/download/${connectionId}/geotiff/${workspace}/${coverageName}`
  window.open(url, '_blank')
}

export function downloadSyncLogs(taskId: string): void {
  const url = `${API_BASE}/download/logs/${taskId}`
  window.open(url, '_blank')
}

// ============================================================================
// Universal Search API
// ============================================================================

export interface SearchResult {
  type: 'workspace' | 'datastore' | 'coveragestore' | 'layer' | 'style' | 'layergroup' | 'pgservice' | 'pgschema' | 'pgtable' | 'pgview' | 'pgcolumn' | 'pgfunction' | 's3connection' | 's3bucket' | 's3object' | 'qgisproject' | 'geonodeconnection' | 'geonodedataset' | 'geonodemap' | 'geonodedocument' | 'geonodegeostory' | 'geonodedashboard'
  name: string
  workspace?: string
  storeName?: string
  storeType?: string
  connectionId: string
  serverName: string
  tags: string[]
  description?: string
  icon: string
  // PostgreSQL-specific fields
  serviceName?: string
  schemaName?: string
  tableName?: string
  dataType?: string
  // S3-specific fields
  s3ConnectionId?: string
  s3Bucket?: string
  s3Key?: string
  // QGIS-specific fields
  qgisProjectId?: string
  qgisProjectPath?: string
  // GeoNode-specific fields
  geonodeConnectionId?: string
  geonodeResourcePk?: number
  geonodeAlternate?: string
  geonodeUrl?: string
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}

export async function search(query: string, connectionId?: string): Promise<SearchResponse> {
  let url = `${API_BASE}/search?q=${encodeURIComponent(query)}`
  if (connectionId) {
    url += `&connection=${encodeURIComponent(connectionId)}`
  }
  const response = await fetch(url)
  return handleResponse<SearchResponse>(response)
}

export async function getSearchSuggestions(): Promise<{
  suggestions: string[]
}> {
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
  hidden: boolean
  online?: boolean | null
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

export async function getPGServices(): Promise<PGService[]> {
  const response = await fetch(`${API_BASE}/pg/services`)
  return handleResponse<PGService[]>(response)
}

export async function getPGDatabaseNames(serviceName: string): Promise<string[]> {
  const response = await fetch(
    `${API_BASE}/pg/services/${encodeURIComponent(serviceName)}/database-names`
  )
  return handleResponse<string[]>(response)
}

export async function getPGSchemaNames(serviceName: string, database: string): Promise<string[]> {
  const response = await fetch(
    `${API_BASE}/pg/services/${encodeURIComponent(serviceName)}/schema-names/${encodeURIComponent(database)}`
  )
  return handleResponse<string[]>(response)
}

export async function createPGService(service: PGServiceCreate): Promise<PGService> {
  const response = await fetch(`${API_BASE}/pg/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(service),
  })
  return handleResponse<PGService>(response)
}

export async function deletePGService(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

export async function testPGService(name: string): Promise<{
  success: boolean;
  message: string
}> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}/test`, {
    method: 'POST',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

export async function parsePGService(name: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}/parse`, {
    method: 'POST',
  })
  return handleResponse<unknown>(response)
}

export async function setPGServiceHidden(name: string, hidden: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}/hide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden }),
  })
  return handleResponse<void>(response)
}

// PostgreSQL server statistics
export interface PGServerStats {
  version: string
  server_start_time: string
  uptime: string
  host: string
  port: string
  database_name: string
  database_size: string
  database_oid: number
  max_connections: number
  current_connections: number
  active_connections: number
  idle_connections: number
  idle_in_transaction_connections: number
  waiting_connections: number
  connection_percent: number
  num_backends: number
  xact_commit: number
  xact_rollback: number
  blks_read: number
  blks_hit: number
  tup_returned: number
  tup_fetched: number
  tup_inserted: number
  tup_updated: number
  tup_deleted: number
  cache_hit_ratio: string
  dead_tuples: number
  live_tuples: number
  table_count: number
  index_count: number
  view_count: number
  function_count: number
  schema_count: number
  is_in_recovery: boolean
  replay_lag?: string
  installed_extensions: string[]
  has_postgis: boolean
  postgis_version?: string
  geometry_columns?: number
  raster_columns?: number
}

export async function getPGServiceStats(name: string): Promise<PGServerStats> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(name)}/stats`)
  return handleResponse<PGServerStats>(response)
}

// Schema Statistics types
export interface PGTableStats {
  name: string
  row_count: number
  size: string
  size_bytes: number
  dead_tuples: number
  last_vacuum?: string
  last_autovacuum?: string
  index_count: number
  has_primary_key: boolean
  has_geometry: boolean
  geometry_type?: string
  srid?: number
}

export interface PGViewStats {
  name: string
  definition?: string
  is_materialized: boolean
}

export interface PGSchemaStats {
  name: string
  owner: string
  database_name: string
  table_count: number
  view_count: number
  index_count: number
  function_count: number
  sequence_count: number
  trigger_count: number
  total_size: string
  total_size_bytes: number
  total_rows: number
  dead_tuples: number
  table_usage?: string
  tables: PGTableStats[]
  views: PGViewStats[]
  has_postgis: boolean
  geometry_columns: number
  raster_columns: number
}

export async function getPGSchemaStats(serviceName: string, schemaName: string): Promise<PGSchemaStats> {
  const response = await fetch(
    `${API_BASE}/pg/services/${encodeURIComponent(serviceName)}/schemas/${encodeURIComponent(schemaName)}/stats`
  )
  return handleResponse<PGSchemaStats>(response)
}

// ============================================================================
// PostgreSQL Data Import API
// ============================================================================

export interface OGR2OGRStatus {
  available: boolean
  version: string
  raster_available: boolean
  raster_version: string
  supported_formats: string[]
  supported_extensions: Record<string, string>
  vector_extensions: Record<string, string>
  raster_extensions: Record<string, string>
}

export interface LayerInfo {
  name: string
  geometry_type: string
  feature_count: number
  srid: number
  fields: Array<{
    name: string
    type: string
    width: number
    nullable: boolean
  }>
  extent?: {
    min_x: number
    min_y: number
    max_x: number
    max_y: number
  }
}

export interface ImportJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  error?: string
}

export interface ImportRequest {
  filePath: string
  serviceName: string
  schema?: string
  tableName?: string
  srid?: number
  overwrite?: boolean
  sourceLayer?: string
}

export interface RasterImportRequest {
  filePath: string
  serviceName: string
  schema?: string
  tableName?: string
  srid?: number
  tileSize?: string
  overwrite?: boolean
}

export async function getOGR2OGRStatus(): Promise<OGR2OGRStatus> {
  const response = await fetch(`${getApiBase()}/pg/ogr2ogr/status`)
  return handleResponse<OGR2OGRStatus>(response)
}

export async function uploadFileForImport(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ file_path: string; filename: string; message: string }> {
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

    xhr.open('POST', `${API_BASE}/pg/import/upload`)
    xhr.send(formData)
  })
}

export async function detectLayers(filePath: string): Promise<Array<{ name: string }>> {
  const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || ''
  const response = await fetch(`${API_BASE}/pg/detect-layers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
    credentials: 'include',
    body: JSON.stringify({ filePath }),
  })
  const data = await handleResponse<{ layers: string[]; file: string }>(response)
  return data.layers.map((name) => ({ name }))
}

export async function startVectorImport(request: ImportRequest): Promise<{
  jobId: string;
  status: string;
  error?: string;
}> {
  const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || ''
  const response = await fetch(`${API_BASE}/pg/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
    credentials: 'include',
    body: JSON.stringify(request),
  })
  return handleResponse<{ jobId: string; status: string; error?: string }>(response)
}

export async function startRasterImport(request: RasterImportRequest): Promise<{
  jobId: string;
  status: string;
  error?: string;
}> {
  const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || ''
  const response = await fetch(`${API_BASE}/pg/import/raster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
    credentials: 'include',
    body: JSON.stringify(request),
  })
  return handleResponse<{ jobId: string; status: string; error?: string }>(response)
}

export async function getImportJobStatus(jobId: string): Promise<ImportJob> {
  const response = await fetch(`${API_BASE}/pg/import/${jobId}`, { credentials: 'include' })
  return handleResponse<ImportJob>(response)
}

// ============================================================================
// Query Execution API
// ============================================================================

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  row_count: number
  duration_ms: number
}

export interface ExecuteQueryResponse {
  success: boolean
  sql: string
  result: QueryResult
}

export async function executeQuery(
  serviceName: string,
  sql: string,
  maxRows: number = 100
): Promise<ExecuteQueryResponse> {
  const response = await fetch(`${API_BASE}/pg/services/${encodeURIComponent(serviceName)}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: sql,
      limit: maxRows,
    }),
  })
  return handleResponse<ExecuteQueryResponse>(response)
}

export async function getTableData(
  serviceName: string,
  schemaName: string,
  tableName: string,
  limit: number = 100,
  offset: number = 0
): Promise<ExecuteQueryResponse> {
  const sql = `SELECT *
               FROM "${schemaName}"."${tableName}" LIMIT ${limit}
               OFFSET ${offset}`
  return executeQuery(serviceName, sql, limit)
}

// ============================================================================
// Documentation API
// ============================================================================

export interface DocumentationResponse {
  content: string
  title: string
}

export async function getDocumentation(): Promise<DocumentationResponse> {
  const response = await fetch(`${API_BASE}/docs`)
  return handleResponse<DocumentationResponse>(response)
}

// ============================================================================
// Cloud-Native Conversion API
// ============================================================================

export async function getConversionToolStatus(): Promise<ConversionToolStatus> {
  const response = await fetch(`${API_BASE}/s3/conversion/tools`)
  return handleResponse<ConversionToolStatus>(response)
}

export async function getConversionJobs(): Promise<ConversionJob[]> {
  const response = await fetch(`${API_BASE}/s3/conversion/jobs`)
  return handleResponse<ConversionJob[]>(response)
}

export async function getConversionJob(jobId: string): Promise<ConversionJob> {
  const response = await fetch(`${API_BASE}/s3/conversion/jobs/${jobId}`)
  return handleResponse<ConversionJob>(response)
}

export async function cancelConversionJob(jobId: string): Promise<{
  success: boolean;
  message: string
}> {
  const response = await fetch(`${API_BASE}/s3/conversion/jobs/${jobId}`, {
    method: 'DELETE',
  })
  return handleResponse<{ success: boolean; message: string }>(response)
}

// ============================================================================
// QGIS Projects API
// ============================================================================

export async function getQGISProjects(): Promise<QGISProject[]> {
  const response = await fetch(`${API_BASE}/qgis/projects`)
  return handleResponse<QGISProject[]>(response)
}

export async function getQGISProject(id: string): Promise<QGISProject> {
  const response = await fetch(`${API_BASE}/qgis/projects/${id}`)
  return handleResponse<QGISProject>(response)
}

export async function uploadQGISProject(
  file: File,
  name?: string,
  onProgress?: (progress: number) => void
): Promise<QGISProject> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const progress = Math.round((e.loaded / e.total) * 100)
        onProgress(progress)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText)
          resolve(response)
        } catch {
          reject(new Error('Invalid response from server'))
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText)
          reject(new Error(error.error || `HTTP ${xhr.status}`))
        } catch {
          reject(new Error(xhr.responseText || `HTTP ${xhr.status}`))
        }
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'))
    })

    xhr.open('POST', `${API_BASE}/qgis/projects`)

    const formData = new FormData()
    formData.append('file', file)
    if (name) {
      formData.append('name', name)
    }

    xhr.send(formData)
  })
}

export async function updateQGISProject(id: string, project: Partial<QGISProjectCreate>): Promise<QGISProject> {
  const response = await fetch(`${API_BASE}/qgis/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  })
  return handleResponse<QGISProject>(response)
}

export async function deleteQGISProject(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/qgis/projects/${id}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

export async function getQGISProjectFile(id: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/qgis/projects/${id}/file`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  return response.blob()
}

// QGIS Project Metadata types
export interface QGISExtent {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

export interface QGISLayer {
  id: string
  name: string
  type: string
  provider: string
  source: string
  visible: boolean
  tileUrl?: string
  wmsUrl?: string
  wmsLayers?: string
}

export interface QGISProjectMetadata {
  title: string
  crs: string
  extent?: QGISExtent
  layers: QGISLayer[]
  version: string
  saveUser?: string
  saveDate?: string
}

export async function getQGISProjectMetadata(id: string): Promise<QGISProjectMetadata> {
  const response = await fetch(`${API_BASE}/qgis/projects/${id}/metadata`)
  return handleResponse<QGISProjectMetadata>(response)
}

// ============================================================================
// GeoNode API
// ============================================================================

export async function getGeoNodeConnections(): Promise<GeoNodeConnection[]> {
  const response = await fetch(`${API_BASE}/geonode/connections`)
  return handleResponse<GeoNodeConnection[]>(response)
}

export async function getGeoNodeConnection(id: string): Promise<GeoNodeConnection> {
  const response = await fetch(`${API_BASE}/geonode/connections/${id}`)
  return handleResponse<GeoNodeConnection>(response)
}

export async function createGeoNodeConnection(conn: GeoNodeConnectionCreate): Promise<GeoNodeConnection> {
  const response = await fetch(`${API_BASE}/geonode/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<GeoNodeConnection>(response)
}

export async function updateGeoNodeConnection(id: string, conn: Partial<GeoNodeConnectionCreate>): Promise<GeoNodeConnection> {
  const response = await fetch(`${API_BASE}/geonode/connections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<GeoNodeConnection>(response)
}

export async function deleteGeoNodeConnection(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/geonode/connections/${id}`, {
    method: 'DELETE',
  })
  return handleResponse<void>(response)
}

export async function testGeoNodeConnection(id: string): Promise<GeoNodeTestResult> {
  const response = await fetch(`${API_BASE}/geonode/connections/${id}/test`, {
    method: 'POST',
  })
  return handleResponse<GeoNodeTestResult>(response)
}

export async function testGeoNodeConnectionDirect(conn: GeoNodeConnectionCreate): Promise<GeoNodeTestResult> {
  const response = await fetch(`${API_BASE}/geonode/connections/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<GeoNodeTestResult>(response)
}

export async function getGeoNodeResources(
  connectionId: string,
  resourceType?: string,
  page?: number,
  pageSize?: number
): Promise<GeoNodeResourcesResponse> {
  let url = `${API_BASE}/geonode/connections/${connectionId}/resources`
  const params = new URLSearchParams()
  if (resourceType) params.append('type', resourceType)
  if (page) params.append('page', page.toString())
  if (pageSize) params.append('page_size', pageSize.toString())
  if (params.toString()) url += `?${params.toString()}`
  const response = await fetch(url)
  return handleResponse<GeoNodeResourcesResponse>(response)
}

export async function getGeoNodeDatasets(
  connectionId: string,
  page?: number,
  pageSize?: number
): Promise<GeoNodeDatasetsResponse> {
  let url = `${API_BASE}/geonode/connections/${connectionId}/datasets`
  const params = new URLSearchParams()
  if (page) params.append('page', page.toString())
  if (pageSize) params.append('page_size', pageSize.toString())
  if (params.toString()) url += `?${params.toString()}`
  const response = await fetch(url)
  return handleResponse<GeoNodeDatasetsResponse>(response)
}

export async function getGeoNodeMaps(
  connectionId: string,
  page?: number,
  pageSize?: number
): Promise<GeoNodeMapsResponse> {
  let url = `${API_BASE}/geonode/connections/${connectionId}/maps`
  const params = new URLSearchParams()
  if (page) params.append('page', page.toString())
  if (pageSize) params.append('page_size', pageSize.toString())
  if (params.toString()) url += `?${params.toString()}`
  const response = await fetch(url)
  return handleResponse<GeoNodeMapsResponse>(response)
}

export async function getGeoNodeDocuments(
  connectionId: string,
  page?: number,
  pageSize?: number
): Promise<GeoNodeDocumentsResponse> {
  let url = `${API_BASE}/geonode/connections/${connectionId}/documents`
  const params = new URLSearchParams()
  if (page) params.append('page', page.toString())
  if (pageSize) params.append('page_size', pageSize.toString())
  if (params.toString()) url += `?${params.toString()}`
  const response = await fetch(url)
  return handleResponse<GeoNodeDocumentsResponse>(response)
}

export async function getGeoNodeGeoStories(
  connectionId: string,
  page?: number,
  pageSize?: number
): Promise<GeoNodeGeoStoriesResponse> {
  let url = `${API_BASE}/geonode/connections/${connectionId}/geostories`
  const params = new URLSearchParams()
  if (page) params.append('page', page.toString())
  if (pageSize) params.append('page_size', pageSize.toString())
  if (params.toString()) url += `?${params.toString()}`
  const response = await fetch(url)
  return handleResponse<GeoNodeGeoStoriesResponse>(response)
}

export async function getGeoNodeDashboards(
  connectionId: string,
  page?: number,
  pageSize?: number
): Promise<GeoNodeDashboardsResponse> {
  let url = `${API_BASE}/geonode/connections/${connectionId}/dashboards`
  const params = new URLSearchParams()
  if (page) params.append('page', page.toString())
  if (pageSize) params.append('page_size', pageSize.toString())
  if (params.toString()) url += `?${params.toString()}`
  const response = await fetch(url)
  return handleResponse<GeoNodeDashboardsResponse>(response)
}

export async function getGeoNodeRemoteServices(
  connectionId: string
): Promise<GeoNodeRemoteServicesResponse> {
  const response = await fetch(
    `${API_BASE}/geonode/connections/${connectionId}/remote-services`
  )
  return handleResponse<GeoNodeRemoteServicesResponse>(response)
}

export async function createGeoNodeRemoteService(
  geonodeConnectionId: string,
  geoserverConnectionId: string,
  type: string = 'WMS'
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/geonode/connections/${geonodeConnectionId}/remote-services/${geoserverConnectionId}/connect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    }
  )
  return handleResponse<void>(response)
}

export async function deleteGeoNodeRemoteService(
  connectionId: string,
  serviceId: number
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/geonode/connections/${connectionId}/remote-services/${serviceId}`,
    { method: 'DELETE' }
  )
  return handleResponse<void>(response)
}

export async function getGeoNodeRemoteServiceResources(
  connectionId: string,
  serviceId: number
): Promise<GeoNodeHarvestResourcesResponse> {
  const response = await fetch(
    `${API_BASE}/geonode/connections/${connectionId}/remote-services/${serviceId}/resources`
  )
  return handleResponse<GeoNodeHarvestResourcesResponse>(response)
}

export async function importGeoNodeRemoteServiceResources(
  connectionId: string,
  serviceId: number,
  resourceIds?: string[]
): Promise<{ resources: Array<{ id: string }> }> {
  const response = await fetch(
    `${API_BASE}/geonode/connections/${connectionId}/remote-services/${serviceId}/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceIds }),
    }
  )
  return handleResponse<{ resources: Array<{ id: string }> }>(response)
}

export async function uploadGeoNodeDataset(
  connectionId: string,
  file: File,
  title?: string,
  abstract?: string
): Promise<{
  success: boolean;
  id?: number;
  status?: string;
  message?: string;
  error?: string
}> {
  const formData = new FormData()
  formData.append('file', file)
  if (title) formData.append('title', title)
  if (abstract) formData.append('abstract', abstract)

  const response = await fetch(`${API_BASE}/geonode/connections/${connectionId}/upload`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse(response)
}

export async function downloadGeoNodeDataset(
  connectionId: string,
  datasetPk: number,
  alternate: string,
  format: 'gpkg' | 'shp' | 'csv' | 'json' | 'xlsx' = 'gpkg'
): Promise<{ blob: Blob; filename: string }> {
  const url = `${API_BASE}/geonode/connections/${connectionId}/download/${datasetPk}/${encodeURIComponent(alternate)}?format=${format}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || `HTTP ${response.status}`)
  }

  const blob = await response.blob()
  const cd = response.headers.get('Content-Disposition')
  let filename = `${alternate.replace(':', '_')}.${format}`
  if (cd) {
    const match = cd.match(/filename="?([^"]+)"?/)
    if (match) filename = match[1]
  }

  return { blob, filename }
}

// ============================================================================
// QFieldCloud API
// ============================================================================

const QFIELDCLOUD_BASE = `${API_BASE}/qfieldcloud/connections`

// List all QFieldCloud connections
export async function getQFieldCloudConnections(): Promise<QFieldCloudConnection[]> {
  const response = await fetch(QFIELDCLOUD_BASE)
  return handleResponse<QFieldCloudConnection[]>(response)
}

// Get a single QFieldCloud connection
export async function getQFieldCloudConnection(id: string): Promise<QFieldCloudConnection> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${id}`)
  return handleResponse<QFieldCloudConnection>(response)
}

// Create a new QFieldCloud connection
export async function createQFieldCloudConnection(conn: QFieldCloudConnectionCreate): Promise<QFieldCloudConnection> {
  const response = await fetch(QFIELDCLOUD_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<QFieldCloudConnection>(response)
}

// Update a QFieldCloud connection
export async function updateQFieldCloudConnection(id: string, conn: Partial<QFieldCloudConnectionCreate>): Promise<QFieldCloudConnection> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<QFieldCloudConnection>(response)
}

// Delete a QFieldCloud connection
export async function deleteQFieldCloudConnection(id: string): Promise<void> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${id}`, { method: 'DELETE' })
  return handleResponse<void>(response)
}

// Test an existing QFieldCloud connection
export async function testQFieldCloudConnection(id: string): Promise<QFieldCloudTestResult> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${id}/test`, { method: 'POST' })
  return handleResponse<QFieldCloudTestResult>(response)
}

// Test QFieldCloud connection without saving
export async function testQFieldCloudConnectionDirect(conn: QFieldCloudConnectionCreate): Promise<QFieldCloudTestResult> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<QFieldCloudTestResult>(response)
}

// List projects for a QFieldCloud connection
export async function listQFieldCloudProjects(connectionId: string): Promise<QFieldCloudProject[]> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects`)
  return handleResponse<QFieldCloudProject[]>(response)
}

// Get a single project
export async function getQFieldCloudProject(connectionId: string, projectId: string): Promise<QFieldCloudProject> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}`)
  return handleResponse<QFieldCloudProject>(response)
}

// Create a project
export async function createQFieldCloudProject(connectionId: string, req: QFieldCloudProjectCreate): Promise<QFieldCloudProject> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return handleResponse<QFieldCloudProject>(response)
}

// Update a project
export async function updateQFieldCloudProject(connectionId: string, projectId: string, req: QFieldCloudProjectUpdate): Promise<QFieldCloudProject> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return handleResponse<QFieldCloudProject>(response)
}

// Delete a project
export async function deleteQFieldCloudProject(connectionId: string, projectId: string): Promise<void> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}`, { method: 'DELETE' })
  return handleResponse<void>(response)
}

// List files for a project
export async function listQFieldCloudFiles(connectionId: string, projectId: string): Promise<QFieldCloudFile[]> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/files`)
  return handleResponse<QFieldCloudFile[]>(response)
}

// Upload a file to a project
export async function uploadQFieldCloudFile(connectionId: string, projectId: string, file: File, remoteName?: string): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)
  if (remoteName) formData.append('filename', remoteName)
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/files`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse<void>(response)
}

// Download a file from a project
export function getQFieldCloudFileDownloadUrl(connectionId: string, projectId: string, filename: string): string {
  return `${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/download/${encodeURIComponent(filename)}`
}

// Delete a file from a project
export async function deleteQFieldCloudFile(connectionId: string, projectId: string, filename: string): Promise<void> {
  const response = await fetch(
    `${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/files/${encodeURIComponent(filename)}`,
    { method: 'DELETE' }
  )
  return handleResponse<void>(response)
}

// List jobs for a project
export async function listQFieldCloudJobs(connectionId: string, projectId: string): Promise<QFieldCloudJob[]> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/jobs`)
  return handleResponse<QFieldCloudJob[]>(response)
}

// Create/trigger a job
export async function createQFieldCloudJob(connectionId: string, projectId: string, req: QFieldCloudJobCreate): Promise<QFieldCloudJob> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return handleResponse<QFieldCloudJob>(response)
}

// Get a single job
export async function getQFieldCloudJob(connectionId: string, projectId: string, jobId: string): Promise<QFieldCloudJob> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/jobs/${jobId}`)
  return handleResponse<QFieldCloudJob>(response)
}

// List collaborators for a project
export async function listQFieldCloudCollaborators(connectionId: string, projectId: string): Promise<QFieldCloudCollaborator[]> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/collaborators`)
  return handleResponse<QFieldCloudCollaborator[]>(response)
}

// Add a collaborator to a project
export async function addQFieldCloudCollaborator(connectionId: string, projectId: string, req: QFieldCloudCollaboratorCreate): Promise<QFieldCloudCollaborator> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/collaborators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return handleResponse<QFieldCloudCollaborator>(response)
}

// Update a collaborator's role
export async function updateQFieldCloudCollaborator(connectionId: string, projectId: string, username: string, role: string): Promise<QFieldCloudCollaborator> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/collaborators/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  return handleResponse<QFieldCloudCollaborator>(response)
}

// Remove a collaborator from a project
export async function removeQFieldCloudCollaborator(connectionId: string, projectId: string, username: string): Promise<void> {
  const response = await fetch(
    `${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/collaborators/${encodeURIComponent(username)}`,
    { method: 'DELETE' }
  )
  return handleResponse<void>(response)
}

// List deltas for a project
export async function listQFieldCloudDeltas(connectionId: string, projectId: string): Promise<QFieldCloudDelta[]> {
  const response = await fetch(`${QFIELDCLOUD_BASE}/${connectionId}/projects/${projectId}/deltas`)
  return handleResponse<QFieldCloudDelta[]>(response)
}

// ============================================================================
// Mergin Maps API
// ============================================================================

export async function getMerginMapsConnections(): Promise<MerginMapsConnection[]> {
  const response = await fetch(`${API_BASE}/mergin/connections`)
  return handleResponse<MerginMapsConnection[]>(response)
}

export async function getMerginMapsConnection(id: string): Promise<MerginMapsConnection> {
  const response = await fetch(`${API_BASE}/mergin/connections/${id}`)
  return handleResponse<MerginMapsConnection>(response)
}

export async function createMerginMapsConnection(conn: MerginMapsConnectionCreate): Promise<MerginMapsConnection> {
  const response = await fetch(`${API_BASE}/mergin/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<MerginMapsConnection>(response)
}

export async function updateMerginMapsConnection(id: string, conn: Partial<MerginMapsConnectionCreate>): Promise<MerginMapsConnection> {
  const response = await fetch(`${API_BASE}/mergin/connections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<MerginMapsConnection>(response)
}

export async function deleteMerginMapsConnection(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/mergin/connections/${id}`, { method: 'DELETE' })
  return handleResponse<void>(response)
}

export async function testMerginMapsConnection(id: string): Promise<MerginMapsTestResult> {
  const response = await fetch(`${API_BASE}/mergin/connections/${id}/test`, { method: 'GET' })
  return handleResponse<MerginMapsTestResult>(response)
}

export async function testMerginMapsConnectionDirect(conn: MerginMapsConnectionCreate): Promise<MerginMapsTestResult> {
  const response = await fetch(`${API_BASE}/mergin/connections/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conn),
  })
  return handleResponse<MerginMapsTestResult>(response)
}

export async function getMerginMapsProjects(connectionId: string, namespace?: string): Promise<MerginMapsProjectsResponse> {
  let url = `${API_BASE}/mergin/connections/${connectionId}/projects`
  if (namespace) url += `?namespace=${encodeURIComponent(namespace)}`
  const response = await fetch(url)
  return handleResponse<MerginMapsProjectsResponse>(response)
}

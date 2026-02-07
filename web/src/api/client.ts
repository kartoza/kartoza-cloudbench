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
  Style,
  LayerGroup,
  FeatureType,
  Coverage,
  UploadResult,
  PreviewRequest,
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

// Layer Group API
export async function getLayerGroups(connId: string, workspace: string): Promise<LayerGroup[]> {
  const response = await fetch(`${API_BASE}/layergroups/${connId}/${workspace}`)
  return handleResponse<LayerGroup[]>(response)
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

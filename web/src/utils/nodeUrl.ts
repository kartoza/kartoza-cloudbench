import type { TreeNode, NodeType } from '../types'

const URL_PARAM = 'node'

export function setNodeUrlParam(nodeId: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set(URL_PARAM, nodeId)
  window.history.pushState({ nodeId }, '', url.toString())
}

export function clearNodeUrlParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(URL_PARAM)) return
  url.searchParams.delete(URL_PARAM)
  window.history.pushState({}, '', url.toString())
}

// Same as clearNodeUrlParam, but via replaceState so it doesn't add a
// browser-back stop. For callers (e.g. Map Explorer, which no longer
// tracks a single selected connection) that want to silently drop stale
// tree-selection context without disturbing history navigation.
export function clearNodeUrlParamQuietly(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(URL_PARAM)) return
  url.searchParams.delete(URL_PARAM)
  window.history.replaceState(window.history.state, '', url.toString())
}

export function getNodeUrlParam(): string | null {
  return new URLSearchParams(window.location.search).get(URL_PARAM)
}

// Returns the node IDs that must be expanded in the tree for a given node to be visible.
export function getParentNodeIds(nodeId: string): string[] {
  const parts = nodeId.split(':')
  const type = parts[0] as NodeType

  switch (type) {
    case 'connection':
      return ['cloudbench-root', 'geoserver']
    case 'workspace':
      return ['cloudbench-root', 'geoserver', `connection:${parts[1]}`]
    // Category containers — parent is the workspace
    case 'datastores':
    case 'coveragestores':
    case 'layers':
    case 'layergroups':
    case 'styles':
      return ['cloudbench-root', 'geoserver', `connection:${parts[1]}`, `workspace:${parts[1]}:${parts[2]}`]
    // Leaf items — parent is the category container inside the workspace
    case 'datastore':
      return ['cloudbench-root', 'geoserver', `connection:${parts[1]}`, `workspace:${parts[1]}:${parts[2]}`, `datastores:${parts[1]}:${parts[2]}`]
    case 'coveragestore':
      return ['cloudbench-root', 'geoserver', `connection:${parts[1]}`, `workspace:${parts[1]}:${parts[2]}`, `coveragestores:${parts[1]}:${parts[2]}`]
    case 'layer':
      return ['cloudbench-root', 'geoserver', `connection:${parts[1]}`, `workspace:${parts[1]}:${parts[2]}`, `layers:${parts[1]}:${parts[2]}`]
    case 'layergroup':
      return ['cloudbench-root', 'geoserver', `connection:${parts[1]}`, `workspace:${parts[1]}:${parts[2]}`, `layergroups:${parts[1]}:${parts[2]}`]
    case 'style':
      return ['cloudbench-root', 'geoserver', `connection:${parts[1]}`, `workspace:${parts[1]}:${parts[2]}`, `styles:${parts[1]}:${parts[2]}`]
    case 'pgservice':
    case 'pgschema':
    case 'pgtable':
      return ['cloudbench-root', 'postgresql']
    case 's3connection':
    case 's3bucket':
      return ['cloudbench-root', 's3storage-root']
    case 'geonodeconnection':
      return ['cloudbench-root', 'geonode-root']
    case 'icebergconnection':
      return ['cloudbench-root', 'iceberg-root']
    case 'qfieldcloudconnection':
      return ['cloudbench-root', 'qfieldcloud-root']
    case 'merginmapsconnection':
      return ['cloudbench-root', 'merginmaps-root']
    case 'qgisproject':
      return ['cloudbench-root', 'qgisprojects-root']
    default:
      return ['cloudbench-root']
  }
}

// Reconstruct a minimal TreeNode from a node ID.
// Node IDs follow the format: "type:part1:part2:..." (from generateNodeId in treeStore).
// The result has enough fields for MainContent to render the correct panel.
export function parseNodeId(nodeId: string): Partial<TreeNode> | null {
  if (!nodeId) return null

  // Handle special-cased hardcoded root IDs
  if (nodeId === 'geoserver') return { id: nodeId, type: 'geoserver', name: 'GeoServer' }
  if (nodeId === 'postgresql') return { id: nodeId, type: 'postgresql', name: 'PostgreSQL' }
  if (nodeId === 's3storage-root') return { id: nodeId, type: 's3storage', name: 'S3 Storage' }
  if (nodeId === 'iceberg-root') return { id: nodeId, type: 'iceberg', name: 'Apache Iceberg' }
  if (nodeId === 'qgisprojects-root') return { id: nodeId, type: 'qgisprojects', name: 'QGIS Projects' }
  if (nodeId === 'geonode-root') return { id: nodeId, type: 'geonode', name: 'GeoNode' }
  if (nodeId === 'qfieldcloud-root') return { id: nodeId, type: 'qfieldcloud', name: 'QFieldCloud' }
  if (nodeId === 'merginmaps-root') return { id: nodeId, type: 'merginmaps', name: 'Mergin Maps' }
  if (nodeId === 'cloudbench-root') return { id: nodeId, type: 'cloudbench', name: 'CloudBench' }

  const parts = nodeId.split(':')
  if (parts.length === 0 || !parts[0]) return null

  const type = parts[0] as NodeType
  const base: Partial<TreeNode> = { id: nodeId, type, name: parts[parts.length - 1] ?? '' }

  switch (type) {
    case 'connection':
      // connection:connId
      return { ...base, connectionId: parts[1] }
    case 'workspace':
      // workspace:connId:wsName
      return { ...base, connectionId: parts[1], workspace: parts[2] }
    case 'datastores':
    case 'coveragestores':
    case 'layers':
    case 'layergroups':
    case 'styles':
      // container:connId:wsName
      return { ...base, connectionId: parts[1], workspace: parts[2] }
    case 'datastore':
    case 'coveragestore':
    case 'layer':
    case 'layergroup':
    case 'style':
      // leaf:connId:wsName:itemName
      return { ...base, connectionId: parts[1], workspace: parts[2], storeName: parts[3] }
    case 'pgservice':
      // pgservice:serviceName
      return { ...base, serviceName: parts[1] }
    case 's3connection':
      // s3connection:s3ConnId
      return { ...base, s3ConnectionId: parts[1] }
    case 's3bucket':
      // s3bucket:s3ConnId:bucketName
      return { ...base, s3ConnectionId: parts[1], s3Bucket: parts[2] }
    case 'geonodeconnection':
      // geonodeconnection:connId
      return { ...base, geonodeConnectionId: parts[1] }
    case 'icebergconnection':
      // icebergconnection:connId
      return { ...base, icebergConnectionId: parts[1] }
    case 'qfieldcloudconnection':
      // qfieldcloudconnection:connId
      return { ...base, qfieldcloudConnectionId: parts[1] }
    case 'merginmapsconnection':
      // merginmapsconnection:connId
      return { ...base, merginMapsConnectionId: parts[1] }
    default:
      return base
  }
}

import { create } from 'zustand'
import type { TreeNode, NodeType } from '../types'

interface TreeState {
  expandedNodes: Set<string>
  selectedNode: TreeNode | null

  // Actions
  toggleNode: (nodeId: string) => void
  expandNode: (nodeId: string) => void
  collapseNode: (nodeId: string) => void
  selectNode: (node: TreeNode | null) => void
  isExpanded: (nodeId: string) => boolean
  clearSelection: () => void
  reset: () => void
}

export const useTreeStore = create<TreeState>((set, get) => ({
  expandedNodes: new Set<string>(),
  selectedNode: null,

  toggleNode: (nodeId: string) => {
    set(state => {
      const newExpanded = new Set(state.expandedNodes)
      if (newExpanded.has(nodeId)) {
        newExpanded.delete(nodeId)
      } else {
        newExpanded.add(nodeId)
      }
      return { expandedNodes: newExpanded }
    })
  },

  expandNode: (nodeId: string) => {
    set(state => {
      const newExpanded = new Set(state.expandedNodes)
      newExpanded.add(nodeId)
      return { expandedNodes: newExpanded }
    })
  },

  collapseNode: (nodeId: string) => {
    set(state => {
      const newExpanded = new Set(state.expandedNodes)
      newExpanded.delete(nodeId)
      return { expandedNodes: newExpanded }
    })
  },

  selectNode: (node: TreeNode | null) => {
    set({ selectedNode: node })
  },

  isExpanded: (nodeId: string) => {
    return get().expandedNodes.has(nodeId)
  },

  clearSelection: () => {
    set({ selectedNode: null })
  },

  reset: () => {
    set({ expandedNodes: new Set(), selectedNode: null })
  },
}))

// Helper function to generate a unique node ID
export function generateNodeId(
  type: NodeType | string,
  connectionId?: string,
  workspace?: string,
  name?: string
): string {
  const parts = [type]
  if (connectionId) parts.push(connectionId)
  if (workspace) parts.push(workspace)
  if (name) parts.push(name)
  return parts.join(':')
}

// Helper function to get icon for node type
export function getNodeIcon(type: NodeType | string): string {
  switch (type) {
    case 'root':
      return '🌍'
    case 'connection':
      return '🖥️'
    case 'workspace':
      return '📁'
    case 'datastores':
      return '💾'
    case 'coveragestores':
      return '🖼️'
    case 'datastore':
      return '🗃️'
    case 'coveragestore':
      return '📷'
    case 'layers':
      return '📑'
    case 'layer':
      return '📄'
    case 'styles':
      return '🎨'
    case 'style':
      return '🖌️'
    case 'layergroups':
      return '📚'
    case 'layergroup':
      return '📘'
    default:
      return '❓'
  }
}

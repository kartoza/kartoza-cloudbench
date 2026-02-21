import type { TreeNode, NodeType } from '../../types'

export interface ConnectionNodeProps {
  connectionId: string
  name: string
  url: string
}

export interface WorkspaceNodeProps {
  connectionId: string
  workspace: string
}

export interface CategoryNodeProps {
  connectionId: string
  workspace: string
  category: 'datastores' | 'coveragestores' | 'layers' | 'styles' | 'layergroups'
  label: string
}

export interface ItemNodeProps {
  connectionId: string
  workspace: string
  name: string
  type: NodeType
  storeType?: string
}

export interface PGServiceNodeProps {
  service: {
    name: string
    host?: string
    port?: string
    dbname?: string
    is_parsed: boolean
    hidden?: boolean
  }
}

export interface PGSchemaNodeProps {
  serviceName: string
  schema: {
    name: string
    tables: { name: string; schema: string; is_view?: boolean; columns: { name: string; type: string; nullable: boolean }[] }[]
  }
}

export interface PGTableNodeProps {
  serviceName: string
  schemaName: string
  table: {
    name: string
    is_view?: boolean
    columns: { name: string; type: string; nullable: boolean }[]
  }
}

export interface PGColumnRowProps {
  serviceName: string
  schemaName: string
  tableName: string
  column: { name: string; type: string; nullable: boolean }
}

export interface DataStoreContentsNodeProps {
  connectionId: string
  workspace: string
  storeName: string
  featureTypes: { name: string }[]
  availableFeatureTypes: string[]
}

export interface CoverageStoreContentsNodeProps {
  connectionId: string
  workspace: string
  storeName: string
  coverages: { name: string }[]
}

export interface DatasetRowProps {
  name: string
  isPublished: boolean
  isCoverage?: boolean
  bg: string
  isSelected?: boolean
  onToggleSelect?: () => void
  onPublish?: () => void
  onPreview?: () => void
}

export interface TreeNodeRowProps {
  node: TreeNode
  isExpanded: boolean
  isSelected: boolean
  isLoading: boolean
  onClick: () => void
  onAdd?: (e: React.MouseEvent) => void
  onEdit?: (e: React.MouseEvent) => void
  onDelete?: (e: React.MouseEvent) => void
  onPreview?: (e: React.MouseEvent) => void
  onTerria?: (e: React.MouseEvent) => void
  onOpenAdmin?: (e: React.MouseEvent) => void
  onQuery?: (e: React.MouseEvent) => void
  onShowData?: (e: React.MouseEvent) => void
  onUpload?: (e: React.MouseEvent) => void
  onRefresh?: (e: React.MouseEvent) => void
  onDownloadConfig?: (e: React.MouseEvent) => void
  onDownloadData?: (e: React.MouseEvent) => void
  downloadDataLabel?: string
  level: number
  isLeaf?: boolean
  count?: number
}

// S3 Storage types
export interface S3ConnectionNodeProps {
  connection: {
    id: string
    name: string
    endpoint: string
    isActive: boolean
  }
}

export interface S3BucketNodeProps {
  connectionId: string
  bucket: {
    name: string
    creationDate: string
  }
}

export interface S3ObjectNodeProps {
  connectionId: string
  bucket: string
  object: {
    key: string
    size: number
    lastModified: string
    contentType?: string
    isFolder: boolean
  }
  prefix?: string
}

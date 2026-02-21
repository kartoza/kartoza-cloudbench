import type { NodeType } from '../../types'
import {
  FiEye,
  FiServer,
  FiFolder,
  FiDatabase,
  FiImage,
  FiLayers,
  FiDroplet,
  FiGrid,
  FiFileText,
  FiMap,
  FiGlobe,
  FiCloud,
  FiTable,
  FiColumns,
  FiHardDrive,
  FiArchive,
  FiFile,
} from 'react-icons/fi'
import { SiPostgresql, SiAmazons3 } from 'react-icons/si'

// Get the icon component for each node type
export function getNodeIconComponent(type: NodeType | 'featuretype' | 'coverage') {
  switch (type) {
    case 'cloudbench':
      return FiCloud
    case 'geoserver':
      return FiGlobe
    case 'postgresql':
      return SiPostgresql
    case 's3storage':
      return SiAmazons3
    case 'connection':
      return FiServer
    case 'pgservice':
      return FiDatabase
    case 'pgschema':
      return FiFolder
    case 'pgtable':
      return FiTable
    case 'pgview':
      return FiEye
    case 'pgcolumn':
      return FiColumns
    case 's3connection':
      return FiHardDrive
    case 's3bucket':
      return FiArchive
    case 's3folder':
      return FiFolder
    case 's3object':
      return FiFile
    case 'workspace':
      return FiFolder
    case 'datastores':
    case 'datastore':
      return FiDatabase
    case 'coveragestores':
    case 'coveragestore':
      return FiImage
    case 'layers':
    case 'layer':
      return FiLayers
    case 'styles':
    case 'style':
      return FiDroplet
    case 'layergroups':
    case 'layergroup':
      return FiGrid
    case 'featuretype':
      return FiFileText
    case 'coverage':
      return FiMap
    default:
      return FiFolder
  }
}

// Get color for each node type
export function getNodeColor(type: NodeType | 'featuretype' | 'coverage'): string {
  switch (type) {
    case 'cloudbench':
      return 'kartoza.500'
    case 'geoserver':
      return 'blue.500'
    case 'postgresql':
      return 'blue.600'
    case 's3storage':
      return 'orange.500'
    case 'connection':
      return 'kartoza.500'
    case 'pgservice':
      return 'blue.500'
    case 'pgschema':
      return 'cyan.500'
    case 'pgtable':
      return 'green.500'
    case 'pgview':
      return 'purple.500'
    case 'pgcolumn':
      return 'gray.500'
    case 's3connection':
      return 'orange.500'
    case 's3bucket':
      return 'yellow.600'
    case 's3folder':
      return 'yellow.500'
    case 's3object':
      return 'orange.400'
    case 'workspace':
      return 'accent.400'
    case 'datastores':
    case 'datastore':
      return 'green.500'
    case 'coveragestores':
    case 'coveragestore':
      return 'purple.500'
    case 'layers':
    case 'layer':
      return 'blue.500'
    case 'styles':
    case 'style':
      return 'pink.500'
    case 'layergroups':
    case 'layergroup':
      return 'cyan.500'
    case 'featuretype':
      return 'teal.500'
    case 'coverage':
      return 'orange.500'
    default:
      return 'gray.500'
  }
}

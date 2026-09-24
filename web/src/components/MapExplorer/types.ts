export interface MapLayerState {
  id: string
  connectionId: string
  bucketName: string
  key: string
  name: string
  format: 'pmtiles' | 'cog'
  color: string
  opacity: number
  status: 'loading' | 'ready' | 'error'
  bounds?: [number, number, number, number]
  isVector?: boolean
  sourceLayer?: string
  hasCustomStyle?: boolean
  styleMode?: 'default' | 'custom'
  /** Legend entries derived from the saved custom style, when there is one. */
  customLegend?: LegendItem[]
}

export interface LegendItem {
  label: string
  color: string
  kind: 'fill' | 'line' | 'circle'
}

/** A layer discovered across any connected S3 bucket that can be searched for and added to the map. */
export interface LayerSearchOption {
  connectionId: string
  connectionName: string
  bucketName: string
  key: string
  name: string
  format: 'pmtiles' | 'cog'
}

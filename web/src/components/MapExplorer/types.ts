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

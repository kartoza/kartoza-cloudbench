export interface MapLayerState {
  id: string
  key: string
  name: string
  format: 'pmtiles' | 'cog'
  color: string
  opacity: number
  status: 'loading' | 'ready' | 'error'
  bounds?: [number, number, number, number]
}

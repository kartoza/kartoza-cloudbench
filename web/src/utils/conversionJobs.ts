// Helpers for showing CloudNativeGIS conversion jobs (the upload dialog and
// the header's Jobs panel).

import type { ConversionJob } from '../types'

export interface LayerProgressStatus {
  name: string
  status: 'done' | 'active' | 'pending'
}

// Derives a per-layer done/active/pending breakdown from the job's coarse
// 20-80% "converting" progress window and cng-lite's processing order
// (job.layers), so the picked GeoPackage layers show individual progress
// instead of one opaque bar.
export function layerConversionStatuses(job: ConversionJob): LayerProgressStatus[] | null {
  const layers = job.layers
  if (!layers || layers.length === 0) return null

  const fraction = Math.min(1, Math.max(0, (job.progress - 20) / 60))
  const activeIndex = Math.floor(fraction * layers.length)
  const allDone = job.status === 'completed' || activeIndex >= layers.length

  return layers.map((name, index) => ({
    name,
    status: allDone || index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  }))
}

export function isActiveJob(job: ConversionJob): boolean {
  return job.status === 'pending' || job.status === 'running'
}

// What a job produces, for its label: vector layers, rasters, or a mosaic of them.
export function jobKindLabel(job: ConversionJob): string {
  if (job.targetFormat === 'mosaic') return 'COG mosaic'
  return job.targetFormat === 'cog' ? 'COG' : 'PMTiles + GeoParquet'
}

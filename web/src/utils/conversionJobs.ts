// Helpers for showing CloudNativeGIS conversion jobs (the upload dialog and
// the header's Jobs panel).

import type { ConversionJob, ConversionJobStatus } from '../types'

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

// Not finished yet - matches ACTIVE_CNG_LITE_JOB_STATUSES on the backend.
const ACTIVE_JOB_STATUSES: readonly ConversionJobStatus[] = [
  'pending',
  'provisioning',
  'pushing',
  'polling',
  'verifying',
  'publishing',
  'downloading',
  'running',
]

export function isActiveStatus(status: ConversionJobStatus | undefined): boolean {
  return !!status && ACTIVE_JOB_STATUSES.includes(status)
}

export function isActiveJob(job: ConversionJob): boolean {
  return isActiveStatus(job.status)
}

// What a job produces, for its label: vector layers, rasters, a mosaic, or a point cloud.
export function jobKindLabel(job: ConversionJob): string {
  if (job.targetFormat === 'mosaic') return 'COG mosaic'
  if (job.targetFormat === 'copc') return 'COPC point cloud'
  return job.targetFormat === 'cog' ? 'COG' : 'PMTiles + GeoParquet'
}

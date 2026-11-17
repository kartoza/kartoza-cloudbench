// Helpers for showing CloudNativeGIS conversion jobs (the upload dialog and
// the header's Jobs panel).

import type { ConversionJob, ConversionJobStatus } from '../types'

export interface LayerProgressStatus {
  name: string
  status: 'done' | 'active' | 'pending' | 'skipped'
  // Why it was skipped.
  error?: string
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

  const skipped = new Map((job.skipped ?? []).map((s) => [s.name, s.error]))
  return layers.map((name, index) =>
    skipped.has(name)
      ? { name, status: 'skipped', error: skipped.get(name) }
      : {
          name,
          status: allDone || index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
        },
  )
}

// The layers that were skipped, and why: from job.skipped, or (for a job
// recorded before that existed) its error, "name: reason; name: reason".
export function skippedLayers(job: ConversionJob): { name: string; error: string }[] {
  if (job.skipped?.length) return job.skipped
  if (!job.error || job.status !== 'completed') return []
  return job.error.split('; ').map((line) => {
    const at = line.indexOf(': ')
    return at > 0 ? { name: line.slice(0, at), error: line.slice(at + 2) } : { name: '', error: line }
  })
}

// Not finished yet - matches ACTIVE_CNG_LITE_JOB_STATUSES on the backend.
const ACTIVE_JOB_STATUSES: readonly ConversionJobStatus[] = [
  'pending',
  'provisioning',
  'pushing',
  'polling',
  'verifying',
  'publishing',
  'deprovisioning',
  'cancelling',
]

// What can still be cancelled - matches CANCELLABLE_CNG_LITE_JOB_STATUSES:
// not once it's publishing (the catalog would be half-written) or finishing.
const CANCELLABLE_JOB_STATUSES: readonly ConversionJobStatus[] = [
  'pending',
  'provisioning',
  'pushing',
  'polling',
]

export function isCancellableJob(job: ConversionJob): boolean {
  return CANCELLABLE_JOB_STATUSES.includes(job.status)
}

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

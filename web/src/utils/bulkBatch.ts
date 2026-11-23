import type { BulkBatch, BulkJob, BulkKind, BulkServers } from '../api/bulk'

export const KIND_LABELS: Record<BulkKind, string> = {
  pmtiles: 'PMTiles + GeoParquet',
  cog: 'COG',
  copc: 'COPC',
}

export const KIND_COLORS: Record<BulkKind, string> = {
  pmtiles: 'blue',
  cog: 'purple',
  copc: 'teal',
}

export interface BatchCounts {
  total: number
  waiting: number
  running: number
  completed: number
  failed: number
  skipped: number
  cancelled: number
}

export function batchCounts(batch: Pick<BulkBatch, 'jobs'>): BatchCounts {
  const count = (status: BulkJob['status']) => batch.jobs.filter((job) => job.status === status).length
  return {
    total: batch.jobs.length,
    waiting: count('queued'),
    running: count('running'),
    completed: count('completed'),
    failed: count('failed'),
    skipped: count('skipped'),
    cancelled: count('cancelled'),
  }
}

// 0-100: finished jobs, plus the running ones' progress.
export function batchProgress(batch: Pick<BulkBatch, 'jobs'>): number {
  if (batch.jobs.length === 0) return 100
  const done = batch.jobs.reduce((sum, job) => {
    if (job.status === 'queued') return sum
    return sum + (job.status === 'running' ? job.progress : 100)
  }, 0)
  return Math.round(done / batch.jobs.length)
}

// "12 of 23 done · 2 running · 1 failed · 1 cancelled", for a batch's summary
// line. "Done" only counts a real success - a failed or cancelled layer is
// just as over, but isn't "done" by any reasonable reading of the word, so
// it's broken out on its own instead of being folded silently into the
// count (which used to make a batch that failed or was cancelled outright
// still claim everything was "done").
export function batchSummary(batch: Pick<BulkBatch, 'jobs'>): string {
  const counts = batchCounts(batch)
  const parts = [`${counts.completed} of ${counts.total} done`]
  if (counts.running) parts.push(`${counts.running} running`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (counts.cancelled) parts.push(`${counts.cancelled} cancelled`)
  return parts.join(' · ')
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

// How a batch's on-demand servers are doing, e.g. "Servers: 2 ready, 1 starting".
export function serversSummary(servers: BulkServers): string {
  const parts = [
    servers.ready && `${servers.ready} ready`,
    servers.starting && `${servers.starting} starting`,
    servers.stopping && `${servers.stopping} being deleted`,
    servers.failed && `${servers.failed} failed to start`,
  ].filter(Boolean)
  return `Servers: ${parts.length ? parts.join(', ') : 'none running'}`
}

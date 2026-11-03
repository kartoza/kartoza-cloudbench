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
  // Jobs that are over, however they ended.
  finished: number
}

export function batchCounts(batch: Pick<BulkBatch, 'jobs'>): BatchCounts {
  const count = (status: BulkJob['status']) => batch.jobs.filter((job) => job.status === status).length
  const waiting = count('queued')
  const running = count('running')
  return {
    total: batch.jobs.length,
    waiting,
    running,
    completed: count('completed'),
    failed: count('failed'),
    skipped: count('skipped'),
    cancelled: count('cancelled'),
    finished: batch.jobs.length - waiting - running,
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

// "12 of 23 done · 2 running · 1 failed", for a batch's summary line.
export function batchSummary(batch: Pick<BulkBatch, 'jobs'>): string {
  const counts = batchCounts(batch)
  const parts = [`${counts.finished} of ${counts.total} done`]
  if (counts.running) parts.push(`${counts.running} running`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
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

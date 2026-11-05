import { describe, expect, it } from 'vitest'

import type { BulkJob, BulkJobStatus } from '../api/bulk'
import { batchCounts, batchSummary } from './bulkBatch'

function job(status: BulkJobStatus): BulkJob {
  return { key: status, name: `${status}.tif`, kind: 'cog', status, progress: status === 'completed' ? 100 : 0, message: '' }
}

function batchOf(statuses: BulkJobStatus[]) {
  return { jobs: statuses.map(job) }
}

describe('batchCounts', () => {
  it('counts each status on its own, with no combined "finished" bucket', () => {
    const counts = batchCounts(
      batchOf(['completed', 'completed', 'failed', 'cancelled', 'running', 'queued']),
    )
    expect(counts).toEqual({
      total: 6,
      waiting: 1,
      running: 1,
      completed: 2,
      failed: 1,
      skipped: 0,
      cancelled: 1,
    })
  })
})

describe('batchSummary', () => {
  it('only counts a real success as "done"', () => {
    // A batch that was cancelled with some failures: it must not read as
    // "everything done" just because nothing is queued or running any more.
    const summary = batchSummary(batchOf(['completed', 'failed', 'failed', 'cancelled', 'cancelled']))
    expect(summary).toBe('1 of 5 done · 2 failed · 2 cancelled')
  })

  it('omits a zero count rather than showing "0 failed"/"0 cancelled"', () => {
    expect(batchSummary(batchOf(['completed', 'completed', 'queued']))).toBe('2 of 3 done')
  })

  it('still reports running layers', () => {
    expect(batchSummary(batchOf(['completed', 'running', 'queued']))).toBe('1 of 3 done · 1 running')
  })
})

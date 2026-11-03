import { SPOOL_PREFIX } from '@internal/spool'
import { memoryBlobStore } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  type CapacityAlert,
  type CapacityReport,
  capacityWatchTask,
  DEFAULT_DISK_WARNING_RATIO,
  DEFAULT_SPOOL_WARNING,
} from './capacity-watch.ts'

const CONTEXT = { scheduledAt: 0, cron: '* * * * *', signal: new AbortController().signal }

async function spoolWith(count: number) {
  const store = memoryBlobStore()
  for (let index = 0; index < count; index += 1) {
    await store.put(`${SPOOL_PREFIX}${index}.ndjson.gz`, new Uint8Array([1]))
  }
  return store
}

async function run(options: Parameters<typeof capacityWatchTask>[0]) {
  const alerts: CapacityAlert[] = []
  const task = capacityWatchTask({ ...options, onAlert: (alert) => alerts.push(alert) })
  const report = (await task.run(CONTEXT)) as CapacityReport
  return { report, alerts }
}

describe('capacityWatchTask', () => {
  it('says nothing while the spool is draining normally', async () => {
    const { report, alerts } = await run({ spool: await spoolWith(3) })

    expect(report.pending).toBe(3)
    expect(alerts).toEqual([])
  })

  it('warns once the backlog reaches the threshold', async () => {
    const { alerts } = await run({ spool: await spoolWith(5), spoolWarning: 5 })

    expect(alerts).toEqual([{ kind: 'spool-backlog', pending: 5, threshold: 5, capped: false }])
  })

  it('warns about a disk with almost nothing left', async () => {
    const { alerts } = await run({
      spool: await spoolWith(0),
      readDisks: async () => [{ name: 'default', freeBytes: 5, totalBytes: 100 }],
    })

    expect(alerts).toEqual([
      { kind: 'disk-low', disk: 'default', freeRatio: 0.05, threshold: DEFAULT_DISK_WARNING_RATIO },
    ])
  })

  it('says nothing about a disk with room', async () => {
    const { alerts, report } = await run({
      spool: await spoolWith(0),
      readDisks: async () => [{ name: 'default', freeBytes: 80, totalBytes: 100 }],
    })

    expect(alerts).toEqual([])
    expect(report.disks).toEqual([{ name: 'default', freeRatio: 0.8 }])
  })

  it('treats a disk it cannot measure as full, not as fine', async () => {
    const { alerts } = await run({
      spool: await spoolWith(0),
      readDisks: async () => [{ name: 'default', freeBytes: 0, totalBytes: 0 }],
    })

    expect(alerts.map((alert) => alert.kind)).toEqual(['disk-low'])
  })

  it('raises an alert when it cannot read the spool at all', async () => {
    const broken = {
      ...memoryBlobStore(),
      list: () => Promise.reject(new Error('R2 is unreachable')),
    }

    const { alerts } = await run({ spool: broken })

    expect(alerts).toEqual([{ kind: 'unreadable', what: 'spool', why: 'R2 is unreachable' }])
  })

  it('raises an alert when it cannot read the disks, instead of reporting none', async () => {
    const { alerts, report } = await run({
      spool: await spoolWith(0),
      readDisks: () => Promise.reject(new Error('ClickHouse refused')),
    })

    expect(alerts).toEqual([{ kind: 'unreadable', what: 'disk', why: 'ClickHouse refused' }])
    expect(report.disks).toEqual([])
  })

  it('still reports the backlog when the disks cannot be read', async () => {
    const { report, alerts } = await run({
      spool: await spoolWith(2),
      readDisks: () => Promise.reject(new Error('down')),
    })

    expect(report.pending).toBe(2)
    expect(alerts).toHaveLength(1)
  })

  it('has a default threshold the operator can rely on', () => {
    expect(DEFAULT_SPOOL_WARNING).toBe(100)
    expect(DEFAULT_DISK_WARNING_RATIO).toBe(0.15)
  })
})

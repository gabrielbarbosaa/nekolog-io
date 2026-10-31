import type { EnvironmentUsage, QuotaStore, UsageStore } from '@internal/adapters'
import { memoryQuotaStore } from '@internal/adapters'
import { describe, expect, it, vi } from 'vitest'
import type { TaskContext } from '../task.ts'
import {
  DEFAULT_DAILY_EVENT_QUOTA,
  QUOTA_BLOCK_TASK,
  type QuotaBlockEvent,
  type QuotaBlockReport,
  quotaBlockTask,
  startOfUtcDay,
} from './quota-block.ts'

const NOON = Date.UTC(2026, 9, 31, 12, 0, 0)
const MIDNIGHT = Date.UTC(2026, 9, 31, 0, 0, 0)

function usageOf(...rows: EnvironmentUsage[]): UsageStore & { asked: number[] } {
  const asked: number[] = []
  return {
    asked,
    async eventsSince(startMs) {
      asked.push(startMs)
      return rows
    },
  }
}

function brokenUsage(): UsageStore {
  return {
    async eventsSince() {
      throw new Error('ClickHouse is unreachable')
    },
  }
}

function context(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    scheduledAt: NOON,
    cron: '* * * * *',
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function run(
  usage: UsageStore,
  quotas: QuotaStore,
  options: { dailyQuota?: number; at?: number; signal?: AbortSignal } = {},
) {
  const events: QuotaBlockEvent[] = []
  const task = quotaBlockTask({
    usage,
    quotas,
    ...(options.dailyQuota === undefined ? {} : { dailyQuota: options.dailyQuota }),
    onEvent: (event) => events.push(event),
  })
  const report = (await task.run(
    context({
      ...(options.at === undefined ? {} : { scheduledAt: options.at }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  )) as QuotaBlockReport

  return { report, events }
}

describe('startOfUtcDay', () => {
  it('walks back to midnight UTC, whatever the local clock says', () => {
    expect(startOfUtcDay(NOON)).toBe(MIDNIGHT)
    expect(startOfUtcDay(MIDNIGHT)).toBe(MIDNIGHT)
    expect(startOfUtcDay(MIDNIGHT + 86_399_999)).toBe(MIDNIGHT)
  })
})

describe('the quota block task', () => {
  it('runs every minute under a stable name', () => {
    const task = quotaBlockTask({ usage: usageOf(), quotas: memoryQuotaStore() })

    expect(task.name).toBe(QUOTA_BLOCK_TASK)
    expect(task.everyMinutes).toBe(1)
  })

  it('counts only what arrived since midnight UTC', async () => {
    const usage = usageOf()

    await run(usage, memoryQuotaStore())

    expect(usage.asked).toEqual([MIDNIGHT])
  })

  it('blocks an environment that reached its quota', async () => {
    const quotas = memoryQuotaStore()

    const { report, events } = await run(
      usageOf({ environmentId: 'e_1', events: 10_000 }),
      quotas,
      { dailyQuota: 10_000 },
    )

    expect(report).toMatchObject({ blocked: 1, unblocked: 0, written: true })
    expect(await quotas.blocked()).toEqual([
      { environmentId: 'e_1', blockedAt: NOON, events: 10_000, quota: 10_000 },
    ])
    expect(events).toEqual([
      { kind: 'blocked', environmentId: 'e_1', events: 10_000, quota: 10_000 },
    ])
  })

  it('leaves an environment alone while it is still under its quota', async () => {
    const quotas = memoryQuotaStore()

    const { report } = await run(usageOf({ environmentId: 'e_1', events: 9_999 }), quotas, {
      dailyQuota: 10_000,
    })

    expect(report).toMatchObject({ blocked: 0, written: false })
    expect(await quotas.blocked()).toEqual([])
  })

  it('writes to the store only when the set of blocked environments changes', async () => {
    const quotas = memoryQuotaStore()
    const replace = vi.spyOn(quotas, 'replace')
    const usage = usageOf({ environmentId: 'e_1', events: 12_000 })

    await run(usage, quotas, { dailyQuota: 10_000 })
    const second = await run(usage, quotas, { dailyQuota: 10_000, at: NOON + 60_000 })

    expect(replace).toHaveBeenCalledTimes(1)
    expect(second.report).toMatchObject({ stillBlocked: 1, written: false })
  })

  it('keeps the moment it first blocked even when a later run rewrites the document', async () => {
    const quotas = memoryQuotaStore()

    await run(usageOf({ environmentId: 'e_1', events: 12_000 }), quotas, { dailyQuota: 10_000 })
    await run(
      usageOf({ environmentId: 'e_1', events: 13_000 }, { environmentId: 'e_2', events: 11_000 }),
      quotas,
      { dailyQuota: 10_000, at: NOON + 600_000 },
    )

    const blocks = await quotas.blocked()
    expect(blocks.find((block) => block.environmentId === 'e_1')).toEqual({
      environmentId: 'e_1',
      blockedAt: NOON,
      events: 12_000,
      quota: 10_000,
    })
    expect(blocks.find((block) => block.environmentId === 'e_2')?.blockedAt).toBe(NOON + 600_000)
  })

  it('lifts the block when the environment stops being over quota', async () => {
    const quotas = memoryQuotaStore()

    await run(usageOf({ environmentId: 'e_1', events: 12_000 }), quotas, { dailyQuota: 10_000 })
    const { report, events } = await run(usageOf({ environmentId: 'e_1', events: 12 }), quotas, {
      dailyQuota: 10_000,
      at: NOON + 86_400_000,
    })

    expect(report).toMatchObject({ unblocked: 1, written: true })
    expect(await quotas.blocked()).toEqual([])
    expect(events[0]).toMatchObject({ kind: 'unblocked', environmentId: 'e_1' })
  })

  it('lifts the block on an environment that went quiet entirely', async () => {
    const quotas = memoryQuotaStore()

    await run(usageOf({ environmentId: 'e_1', events: 12_000 }), quotas, { dailyQuota: 10_000 })
    const { report } = await run(usageOf(), quotas, { dailyQuota: 10_000 })

    expect(report).toMatchObject({ unblocked: 1, written: true })
    expect(await quotas.blocked()).toEqual([])
  })

  it('leaves every block in place when it cannot measure usage', async () => {
    const quotas = memoryQuotaStore()
    await run(usageOf({ environmentId: 'e_1', events: 12_000 }), quotas, { dailyQuota: 10_000 })

    const { report } = await run(brokenUsage(), quotas, { dailyQuota: 10_000 })

    expect(report).toMatchObject({ stopped: 'usage_unavailable', written: false })
    expect((await quotas.blocked()).map((block) => block.environmentId)).toEqual(['e_1'])
  })

  it('blocks one environment without touching another', async () => {
    const quotas = memoryQuotaStore()

    await run(
      usageOf({ environmentId: 'e_1', events: 12_000 }, { environmentId: 'e_2', events: 5 }),
      quotas,
      { dailyQuota: 10_000 },
    )

    expect((await quotas.blocked()).map((block) => block.environmentId)).toEqual(['e_1'])
  })

  it('asks for each environment quota separately when told how', async () => {
    const quotas = memoryQuotaStore()
    const task = quotaBlockTask({
      usage: usageOf({ environmentId: 'e_1', events: 100 }, { environmentId: 'e_2', events: 100 }),
      quotas,
      quotaFor: (environmentId) => (environmentId === 'e_1' ? 50 : 1_000),
    })

    await task.run(context())

    expect((await quotas.blocked()).map((block) => block.environmentId)).toEqual(['e_1'])
  })

  it('writes nothing once it has run out of time', async () => {
    const quotas = memoryQuotaStore()
    const controller = new AbortController()
    controller.abort()

    const { report } = await run(usageOf({ environmentId: 'e_1', events: 12_000 }), quotas, {
      dailyQuota: 10_000,
      signal: controller.signal,
    })

    expect(report.stopped).toBe('out_of_time')
    expect(await quotas.blocked()).toEqual([])
  })

  it('survives a reporter that throws', async () => {
    const quotas = memoryQuotaStore()
    const task = quotaBlockTask({
      usage: usageOf({ environmentId: 'e_1', events: 12_000 }),
      quotas,
      dailyQuota: 10_000,
      onEvent: () => {
        throw new Error('the logger is broken')
      },
    })

    await expect(task.run(context())).resolves.toMatchObject({ blocked: 1 })
  })

  it('falls back to the documented free-tier quota', async () => {
    const quotas = memoryQuotaStore()

    await run(usageOf({ environmentId: 'e_1', events: DEFAULT_DAILY_EVENT_QUOTA }), quotas)

    expect((await quotas.blocked())[0]?.quota).toBe(DEFAULT_DAILY_EVENT_QUOTA)
  })
})

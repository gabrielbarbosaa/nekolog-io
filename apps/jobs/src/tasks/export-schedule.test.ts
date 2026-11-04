import type {
  DueSchedule,
  ExportCadence,
  ExportScheduleStore,
  ScheduledExport,
} from '@nekolog-io/adapters'
import { EXPORT_LIFETIME_DAYS } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../task.ts'
import {
  boundaryFor,
  DAY_MS,
  DEFAULT_SCHEDULE_LAG_MS,
  type ExportScheduleReport,
  exportScheduleTask,
  startOfUtcDay,
  startOfUtcWeek,
  WEEK_MS,
  windowFor,
} from './export-schedule.ts'

const WEDNESDAY = Date.UTC(2026, 10, 4, 9, 30, 0)

function context(at: number, signal = new AbortController().signal): TaskContext {
  return { scheduledAt: at, signal } as TaskContext
}

function schedule(id: string, cadence: ExportCadence = 'daily'): DueSchedule {
  return {
    id,
    projectId: 'prj_1',
    environmentId: 'env_prod',
    format: 'csv',
    cadence,
    query: '',
    createdBy: 'usr_1',
  }
}

type Harness = {
  asked: Array<{ cadence: ExportCadence; boundary: number; limit: number }>
  queued: ScheduledExport[]
  run: (at: number, signal?: AbortSignal) => Promise<ExportScheduleReport>
}

function harness(
  rows: Partial<Record<ExportCadence, DueSchedule[]>>,
  accept: (one: ScheduledExport) => boolean = () => true,
): Harness {
  const asked: Array<{ cadence: ExportCadence; boundary: number; limit: number }> = []
  const queued: ScheduledExport[] = []
  let minted = 0

  const schedules: ExportScheduleStore = {
    async due(cadence, boundary, limit) {
      asked.push({ cadence, boundary, limit })
      return (rows[cadence] ?? []).slice(0, limit)
    },
    async enqueue(one) {
      queued.push(one)
      return accept(one)
    },
  }

  const task = exportScheduleTask({
    schedules,
    newExportId: () => {
      minted += 1
      return `exp_${String(minted).padStart(26, '0').replace(/0/g, 'Z')}`
    },
  })

  return {
    asked,
    queued,
    run: async (at, signal) => (await task.run(context(at, signal))) as ExportScheduleReport,
  }
}

describe('where a period starts', () => {
  it('cuts a day at midnight UTC', () => {
    expect(startOfUtcDay(WEDNESDAY)).toBe(Date.UTC(2026, 10, 4))
    expect(startOfUtcDay(Date.UTC(2026, 10, 4))).toBe(Date.UTC(2026, 10, 4))
  })

  it('cuts a week at Monday, not at Sunday', () => {
    expect(startOfUtcWeek(WEDNESDAY)).toBe(Date.UTC(2026, 10, 2))
    expect(new Date(startOfUtcWeek(WEDNESDAY)).getUTCDay()).toBe(1)
  })

  it('treats Sunday as the end of the week it closes, not the start of a new one', () => {
    const sunday = Date.UTC(2026, 10, 8, 23, 59, 59)

    expect(new Date(sunday).getUTCDay()).toBe(0)
    expect(startOfUtcWeek(sunday)).toBe(Date.UTC(2026, 10, 2))
  })

  it('stays on the same boundary across a leap in the clock, because it counts from the epoch', () => {
    expect(boundaryFor('daily', WEDNESDAY)).toBe(Date.UTC(2026, 10, 4))
    expect(boundaryFor('weekly', WEDNESDAY)).toBe(Date.UTC(2026, 10, 2))
  })
})

describe('the period it exports', () => {
  it('is the day that just closed, never the one in progress', () => {
    expect(windowFor('daily', WEDNESDAY)).toEqual({
      from: Date.UTC(2026, 10, 3),
      to: Date.UTC(2026, 10, 4),
    })
  })

  it('is the week that just closed', () => {
    expect(windowFor('weekly', WEDNESDAY)).toEqual({
      from: Date.UTC(2026, 9, 26),
      to: Date.UTC(2026, 10, 2),
    })
  })

  it('is exactly one period long', () => {
    const daily = windowFor('daily', WEDNESDAY)
    const weekly = windowFor('weekly', WEDNESDAY)

    expect(daily.to - daily.from).toBe(DAY_MS)
    expect(weekly.to - weekly.from).toBe(WEEK_MS)
  })
})

describe('the schedule task', () => {
  it('queues an export for a schedule that is due', async () => {
    const one = harness({ daily: [schedule('exs_a')] })

    const report = await one.run(WEDNESDAY)

    expect(report).toMatchObject({ due: 1, queued: 1, taken: 0 })
    expect(one.queued[0]).toMatchObject({
      scheduleId: 'exs_a',
      rangeFrom: Date.UTC(2026, 10, 3),
      rangeTo: Date.UTC(2026, 10, 4),
      stampedAt: WEDNESDAY,
    })
  })

  it('gives the export the same lifetime the bucket rule enforces', async () => {
    const one = harness({ daily: [schedule('exs_a')] })

    await one.run(WEDNESDAY)

    expect(one.queued[0]?.expiresAt).toBe(WEDNESDAY + EXPORT_LIFETIME_DAYS * DAY_MS)
  })

  it('waits out the lag, so logs arriving late still land in the period', async () => {
    const one = harness({ daily: [schedule('exs_a')] })
    const justAfterMidnight = Date.UTC(2026, 10, 4) + DEFAULT_SCHEDULE_LAG_MS - 1

    const report = await one.run(justAfterMidnight)

    expect(report.due).toBe(0)
    expect(one.asked.some((ask) => ask.cadence === 'daily')).toBe(false)
  })

  it('runs the moment the lag has passed', async () => {
    const one = harness({ daily: [schedule('exs_a')] })

    const report = await one.run(Date.UTC(2026, 10, 4) + DEFAULT_SCHEDULE_LAG_MS)

    expect(report.queued).toBe(1)
  })

  it('asks each cadence for its own boundary', async () => {
    const one = harness({ daily: [schedule('exs_a')], weekly: [schedule('exs_b', 'weekly')] })

    await one.run(WEDNESDAY)

    expect(one.asked).toEqual([
      { cadence: 'daily', boundary: Date.UTC(2026, 10, 4), limit: 25 },
      { cadence: 'weekly', boundary: Date.UTC(2026, 10, 2), limit: 24 },
    ])
  })

  it('counts a schedule another run already took, without calling it queued', async () => {
    const one = harness({ daily: [schedule('exs_a')] }, () => false)

    const report = await one.run(WEDNESDAY)

    expect(report).toMatchObject({ due: 1, queued: 0, taken: 1 })
  })

  it('does nothing at all when nothing is due', async () => {
    const one = harness({})

    expect(await one.run(WEDNESDAY)).toMatchObject({ due: 0, queued: 0, taken: 0 })
    expect(one.queued).toEqual([])
  })

  it('says so rather than guessing when the store cannot be reached', async () => {
    const task = exportScheduleTask({
      schedules: {
        due: async () => {
          throw new Error('postgres is asleep')
        },
        enqueue: async () => true,
      },
      newExportId: () => 'exp_ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
    })

    expect(await task.run(context(WEDNESDAY))).toMatchObject({
      stopped: 'store_unavailable',
      queued: 0,
    })
  })

  it('stops when the deadline passed rather than queueing more', async () => {
    const controller = new AbortController()
    controller.abort()
    const one = harness({ daily: [schedule('exs_a')] })

    const report = await one.run(WEDNESDAY, controller.signal)

    expect(report.stopped).toBe('out_of_time')
    expect(one.queued).toEqual([])
  })

  it('stops partway through a batch when the deadline passes, leaving the rest for next minute', async () => {
    const controller = new AbortController()
    const one = harness(
      { daily: [schedule('exs_a'), schedule('exs_b'), schedule('exs_c')] },
      () => {
        controller.abort()
        return true
      },
    )

    const report = await one.run(WEDNESDAY, controller.signal)

    expect(report.stopped).toBe('out_of_time')
    expect(report.queued).toBe(1)
    expect(one.queued).toHaveLength(1)
  })

  it('mints a separate id for every export it queues', async () => {
    const one = harness({ daily: [schedule('exs_a'), schedule('exs_b')] })

    await one.run(WEDNESDAY)

    expect(new Set(one.queued.map((queued) => queued.exportId)).size).toBe(2)
  })
})

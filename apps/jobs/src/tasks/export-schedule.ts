import {
  EXPORT_CADENCES,
  EXPORT_LIFETIME_DAYS,
  type ExportCadence,
  type ExportScheduleStore,
} from '@nekolog-io/adapters'
import type { Task, TaskContext } from '../task.ts'

export const EXPORT_SCHEDULE_TASK = 'export-schedule'

export const DAY_MS = 24 * 60 * 60 * 1000
export const WEEK_MS = 7 * DAY_MS
export const DEFAULT_SCHEDULE_LAG_MS = 15 * 60 * 1000
export const MAX_SCHEDULES_PER_RUN = 25

export type ScheduleWindow = {
  from: number
  to: number
}

export type ExportScheduleEvent =
  | { kind: 'queued'; scheduleId: string; exportId: string; from: number; to: number }
  | { kind: 'taken'; scheduleId: string }

export type ExportScheduleReport = {
  due: number
  queued: number
  taken: number
  stopped: 'finished' | 'store_unavailable' | 'out_of_time'
}

export type ExportScheduleOptions = {
  schedules: ExportScheduleStore
  newExportId: () => string
  lagMs?: number
  perRun?: number
  lifetimeDays?: number
  onEvent?: (event: ExportScheduleEvent) => void
}

export function startOfUtcDay(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS
}

export function startOfUtcWeek(at: number): number {
  const day = startOfUtcDay(at)
  const weekday = new Date(day).getUTCDay()
  const sinceMonday = (weekday + 6) % 7
  return day - sinceMonday * DAY_MS
}

export function boundaryFor(cadence: ExportCadence, at: number): number {
  return cadence === 'weekly' ? startOfUtcWeek(at) : startOfUtcDay(at)
}

export function windowFor(cadence: ExportCadence, at: number): ScheduleWindow {
  const to = boundaryFor(cadence, at)
  return { from: to - (cadence === 'weekly' ? WEEK_MS : DAY_MS), to }
}

export function exportScheduleTask(options: ExportScheduleOptions): Task {
  const lagMs = options.lagMs ?? DEFAULT_SCHEDULE_LAG_MS
  const perRun = options.perRun ?? MAX_SCHEDULES_PER_RUN
  const lifetimeDays = options.lifetimeDays ?? EXPORT_LIFETIME_DAYS

  return {
    name: EXPORT_SCHEDULE_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<ExportScheduleReport> {
      const report: ExportScheduleReport = {
        due: 0,
        queued: 0,
        taken: 0,
        stopped: 'finished',
      }

      for (const cadence of EXPORT_CADENCES) {
        if (context.signal.aborted) {
          report.stopped = 'out_of_time'
          return report
        }

        const window = windowFor(cadence, context.scheduledAt)
        if (context.scheduledAt < window.to + lagMs) {
          continue
        }

        let due: Awaited<ReturnType<ExportScheduleStore['due']>>
        try {
          due = await options.schedules.due(cadence, window.to, perRun - report.due)
        } catch {
          report.stopped = 'store_unavailable'
          return report
        }

        report.due += due.length

        for (const one of due) {
          if (context.signal.aborted) {
            report.stopped = 'out_of_time'
            return report
          }

          const exportId = options.newExportId()
          let queued: boolean
          try {
            queued = await options.schedules.enqueue({
              scheduleId: one.id,
              exportId,
              rangeFrom: window.from,
              rangeTo: window.to,
              expiresAt: context.scheduledAt + lifetimeDays * DAY_MS,
              stampedAt: context.scheduledAt,
            })
          } catch {
            report.stopped = 'store_unavailable'
            return report
          }

          if (queued) {
            report.queued += 1
            options.onEvent?.({
              kind: 'queued',
              scheduleId: one.id,
              exportId,
              from: window.from,
              to: window.to,
            })
          } else {
            report.taken += 1
            options.onEvent?.({ kind: 'taken', scheduleId: one.id })
          }
        }
      }

      return report
    },
  }
}

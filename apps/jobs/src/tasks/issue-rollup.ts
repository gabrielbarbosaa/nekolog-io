import type { IssueOccurrence, IssueStore } from '@nekolog-io/adapters'
import type { Task, TaskContext } from '../task.ts'

export const ISSUE_ROLLUP_TASK = 'issue-rollup'

export const MINUTE_MS = 60_000
export const DEFAULT_LAG_MINUTES = 1

export type IssueSourceLike = {
  occurrencesBetween(window: { from: number; to: number }): Promise<ReadonlyArray<IssueOccurrence>>
}

export type IssueRollupStop = 'finished' | 'source_unavailable' | 'out_of_time'

export type IssueRollupReport = {
  from: number
  to: number
  occurrences: number
  created: number
  updated: number
  reopened: number
  stopped: IssueRollupStop
}

export type IssueRollupOptions = {
  source: IssueSourceLike
  issues: IssueStore
  lagMinutes?: number
  onReopened?: (occurrence: IssueOccurrence) => void
}

export function windowFor(scheduledAt: number, lagMinutes: number): { from: number; to: number } {
  const minute = Math.floor(scheduledAt / MINUTE_MS) * MINUTE_MS
  const to = minute - lagMinutes * MINUTE_MS
  return { from: to - MINUTE_MS, to }
}

export function issueRollupTask(options: IssueRollupOptions): Task {
  const lagMinutes = options.lagMinutes ?? DEFAULT_LAG_MINUTES

  return {
    name: ISSUE_ROLLUP_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<IssueRollupReport> {
      const { from, to } = windowFor(context.scheduledAt, lagMinutes)
      const report: IssueRollupReport = {
        from,
        to,
        occurrences: 0,
        created: 0,
        updated: 0,
        reopened: 0,
        stopped: 'finished',
      }

      let occurrences: ReadonlyArray<IssueOccurrence>
      try {
        occurrences = await options.source.occurrencesBetween({ from, to })
      } catch {
        report.stopped = 'source_unavailable'
        return report
      }

      report.occurrences = occurrences.length
      if (occurrences.length === 0) {
        return report
      }

      if (context.signal.aborted) {
        report.stopped = 'out_of_time'
        return report
      }

      const rollup = await options.issues.record(occurrences)
      report.created = rollup.created
      report.updated = rollup.updated
      report.reopened = rollup.reopened

      return report
    },
  }
}

import type { QuotaBlock, QuotaStore, UsageStore } from '@internal/adapters'
import type { Task, TaskContext } from '../task.ts'

export const QUOTA_BLOCK_TASK = 'quota-block'

export const DEFAULT_DAILY_EVENT_QUOTA = 10_000

export const DAY_MS = 24 * 60 * 60 * 1000

export type QuotaBlockStop = 'finished' | 'usage_unavailable' | 'out_of_time'

export type QuotaBlockReport = {
  environments: number
  blocked: number
  unblocked: number
  stillBlocked: number
  written: boolean
  stopped: QuotaBlockStop
}

export type QuotaBlockEvent = {
  kind: 'blocked' | 'unblocked'
  environmentId: string
  events: number
  quota: number
}

export type QuotaBlockOptions = {
  usage: UsageStore
  quotas: QuotaStore
  dailyQuota?: number
  quotaFor?: (environmentId: string) => number
  onEvent?: (event: QuotaBlockEvent) => void
}

export function startOfUtcDay(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS
}

function sameEnvironments(
  left: ReadonlyArray<QuotaBlock>,
  right: ReadonlyArray<QuotaBlock>,
): boolean {
  if (left.length !== right.length) {
    return false
  }
  const ids = new Set(left.map((block) => block.environmentId))
  return right.every((block) => ids.has(block.environmentId))
}

export function quotaBlockTask(options: QuotaBlockOptions): Task {
  const fallback = options.dailyQuota ?? DEFAULT_DAILY_EVENT_QUOTA
  const quotaFor = options.quotaFor ?? (() => fallback)

  const report = (event: QuotaBlockEvent): void => {
    try {
      options.onEvent?.(event)
    } catch {
      return
    }
  }

  return {
    name: QUOTA_BLOCK_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<QuotaBlockReport> {
      const result: QuotaBlockReport = {
        environments: 0,
        blocked: 0,
        unblocked: 0,
        stillBlocked: 0,
        written: false,
        stopped: 'finished',
      }

      let usage: Awaited<ReturnType<UsageStore['eventsSince']>>
      try {
        usage = await options.usage.eventsSince(startOfUtcDay(context.scheduledAt))
      } catch {
        result.stopped = 'usage_unavailable'
        return result
      }

      result.environments = usage.length

      const current = await options.quotas.blocked()
      const currentById = new Map(current.map((block) => [block.environmentId, block]))
      const next: QuotaBlock[] = []

      for (const { environmentId, events } of usage) {
        const quota = quotaFor(environmentId)
        if (events < quota) {
          continue
        }

        const existing = currentById.get(environmentId)
        if (existing === undefined) {
          next.push({ environmentId, blockedAt: context.scheduledAt, events, quota })
          result.blocked += 1
          report({ kind: 'blocked', environmentId, events, quota })
        } else {
          next.push(existing)
          result.stillBlocked += 1
        }
      }

      const stayed = new Set(next.map((block) => block.environmentId))
      for (const block of current) {
        if (!stayed.has(block.environmentId)) {
          result.unblocked += 1
          report({
            kind: 'unblocked',
            environmentId: block.environmentId,
            events: block.events,
            quota: block.quota,
          })
        }
      }

      if (context.signal.aborted) {
        result.stopped = 'out_of_time'
        return result
      }

      if (!sameEnvironments(current, next)) {
        await options.quotas.replace(next)
        result.written = true
      }

      return result
    },
  }
}

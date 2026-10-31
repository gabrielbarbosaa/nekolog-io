import { type RunOptions, type RunSummary, runDueTasks } from './run.ts'
import { MINUTE_MS } from './schedule.ts'
import type { Task } from './task.ts'

export const SELF_HOST_CRON = '* * * * *'

export type SchedulerOptions = {
  tasks: readonly Task[]
  cron?: string
  budgetMs?: number
  now?: () => number
  setTimer?: (run: () => void, delayMs: number) => unknown
  clearTimer?: (handle: unknown) => void
  onSummary?: (summary: RunSummary) => void
  onOverlap?: (scheduledAt: number) => void
}

export function msUntilNextMinute(now: number): number {
  return MINUTE_MS - (now % MINUTE_MS)
}

export function gridMinute(now: number): number {
  return Math.round(now / MINUTE_MS) * MINUTE_MS
}

export function startScheduler(options: SchedulerOptions): () => void {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((run, delay) => setTimeout(run, delay))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never))

  let handle: unknown
  let stopped = false
  let running = false
  let lastScheduledAt: number | undefined

  const tick = (): void => {
    if (stopped) {
      return
    }
    const scheduledAt = gridMinute(now())
    queue()

    if (scheduledAt === lastScheduledAt) {
      return
    }
    lastScheduledAt = scheduledAt

    if (running) {
      options.onOverlap?.(scheduledAt)
      return
    }

    running = true
    const run: RunOptions = {
      scheduledAt,
      cron: options.cron ?? SELF_HOST_CRON,
      now,
    }
    if (options.budgetMs !== undefined) {
      run.budgetMs = options.budgetMs
    }
    if (options.onSummary !== undefined) {
      run.onSummary = options.onSummary
    }
    void runDueTasks(options.tasks, run).finally(() => {
      running = false
    })
  }

  function queue(): void {
    if (!stopped) {
      handle = setTimer(tick, msUntilNextMinute(now()))
    }
  }

  queue()

  return () => {
    stopped = true
    clearTimer(handle)
  }
}

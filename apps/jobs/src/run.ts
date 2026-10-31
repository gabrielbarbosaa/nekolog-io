import { dueTasks } from './schedule.ts'
import { DEFAULT_TASK_TIMEOUT_MS, type Task, type TaskContext } from './task.ts'

export const DEFAULT_RUN_BUDGET_MS = 50_000

export const MAX_ERROR_CHARS = 300

export type TaskStatus = 'ok' | 'failed' | 'timed_out'

export type TaskOutcome = {
  name: string
  status: TaskStatus
  durationMs: number
  error?: string
  detail?: Record<string, unknown>
}

export type RunSummary = {
  cron: string
  scheduledAt: number
  durationMs: number
  ran: TaskOutcome[]
  skipped: string[]
  failed: number
}

export type RunOptions = {
  scheduledAt: number
  cron?: string
  budgetMs?: number
  now?: () => number
  onSummary?: (summary: RunSummary) => void
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length > MAX_ERROR_CHARS ? `${single.slice(0, MAX_ERROR_CHARS)}…` : single
}

function asDetail(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

async function runOne(
  task: Task,
  context: Omit<TaskContext, 'signal'>,
  timeoutMs: number,
  now: () => number,
): Promise<TaskOutcome> {
  const startedAt = now()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const expired = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`Task "${task.name}" went past ${timeoutMs} ms`))
      resolve('timed_out')
    }, timeoutMs)
  })

  const started = (async () => task.run({ ...context, signal: controller.signal }))()

  try {
    const finished = await Promise.race([started.then((value) => ({ value })), expired])
    if (finished === 'timed_out') {
      return {
        name: task.name,
        status: 'timed_out',
        durationMs: now() - startedAt,
        error: `No answer within ${timeoutMs} ms`,
      }
    }
    const detail = asDetail(finished.value)
    return {
      name: task.name,
      status: 'ok',
      durationMs: now() - startedAt,
      ...(detail === undefined ? {} : { detail }),
    }
  } catch (error) {
    return {
      name: task.name,
      status: 'failed',
      durationMs: now() - startedAt,
      error: describe(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runDueTasks(
  tasks: readonly Task[],
  options: RunOptions,
): Promise<RunSummary> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const budget = options.budgetMs ?? DEFAULT_RUN_BUDGET_MS
  const due = dueTasks(tasks, options.scheduledAt)
  const context = { scheduledAt: options.scheduledAt, cron: options.cron ?? '' }

  const ran = await Promise.all(
    due.map((task) =>
      runOne(task, context, Math.min(task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS, budget), now),
    ),
  )

  const summary: RunSummary = {
    cron: context.cron,
    scheduledAt: options.scheduledAt,
    durationMs: now() - startedAt,
    ran,
    skipped: tasks.filter((task) => !due.includes(task)).map((task) => task.name),
    failed: ran.filter((outcome) => outcome.status !== 'ok').length,
  }

  try {
    options.onSummary?.(summary)
  } catch {
    return summary
  }
  return summary
}

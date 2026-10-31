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
    const status = await Promise.race([started.then((): 'ok' => 'ok'), expired])
    return status === 'ok'
      ? { name: task.name, status, durationMs: now() - startedAt }
      : {
          name: task.name,
          status,
          durationMs: now() - startedAt,
          error: `No answer within ${timeoutMs} ms`,
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

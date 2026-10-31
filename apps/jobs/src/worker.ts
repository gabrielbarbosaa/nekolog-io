import type { Hono } from 'hono'
import { createJobsApp } from './app.ts'
import { type RunSummary, runDueTasks } from './run.ts'
import type { Task } from './task.ts'
import { SCHEDULED_TASKS } from './tasks.ts'

export type JobsEnv = {
  JOBS_VERSION?: string
}

export type ScheduledEventLike = {
  cron: string
  scheduledTime: number
}

export type ExecutionContextLike = {
  waitUntil: (work: Promise<unknown>) => void
}

export function writeSummary(summary: RunSummary): void {
  const target = (globalThis as { console?: { log?: (...args: unknown[]) => void } }).console
  try {
    target?.log?.(JSON.stringify({ app: 'nekolog/jobs', ...summary }))
  } catch {
    return
  }
}

export function assertNoFailures(summary: RunSummary): RunSummary {
  if (summary.failed === 0) {
    return summary
  }
  const broken = summary.ran
    .filter((outcome) => outcome.status !== 'ok')
    .map((outcome) => `${outcome.name} (${outcome.status})`)
    .join(', ')
  throw new Error(`Scheduled tasks did not finish: ${broken}`)
}

export type RunScheduledOptions = {
  tasks?: readonly Task[]
  onSummary?: (summary: RunSummary) => void
}

export async function runScheduled(
  event: ScheduledEventLike,
  options: RunScheduledOptions = {},
): Promise<RunSummary> {
  const summary = await runDueTasks(options.tasks ?? SCHEDULED_TASKS, {
    scheduledAt: event.scheduledTime,
    cron: event.cron,
    onSummary: options.onSummary ?? writeSummary,
  })
  return assertNoFailures(summary)
}

let cached: Hono | undefined

export default {
  fetch(request: Request, env: JobsEnv, ctx: ExecutionContextLike): Response | Promise<Response> {
    cached ??= createJobsApp({
      taskCount: SCHEDULED_TASKS.length,
      ...(env?.JOBS_VERSION ? { version: env.JOBS_VERSION } : {}),
    })
    return cached.fetch(request, env, ctx as Parameters<Hono['fetch']>[2])
  },

  scheduled(
    event: ScheduledEventLike,
    _env: JobsEnv,
    ctx: ExecutionContextLike,
  ): Promise<RunSummary> {
    const work = runScheduled(event)
    ctx.waitUntil(work)
    return work
  },
}

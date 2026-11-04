import { type KvNamespace, type R2BucketLike, r2BlobStore } from '@nekolog-io/adapters'
import type { Hono } from 'hono'
import { type OperatorAlert, operatorNotifier } from './alerts/operator.ts'
import { createJobsApp } from './app.ts'
import { sendHeartbeat } from './heartbeat.ts'
import { type RunSummary, runDueTasks } from './run.ts'
import type { Task } from './task.ts'
import { buildTasks } from './tasks.ts'
import { assertNoFailures, coreTaskDeps, write, writeSummary } from './wiring.ts'

export {
  assertNoFailures,
  diskReaderFor,
  writeCapacityAlert,
  writeQuotaEvent,
  writeSpoolEvent,
  writeSummary,
} from './wiring.ts'

export type JobsEnv = {
  KEYS: KvNamespace
  SPOOL: R2BucketLike
  CLICKHOUSE_URL: string
  CLICKHOUSE_DB: string
  CLICKHOUSE_JOBS_USER: string
  CLICKHOUSE_JOBS_PASSWORD: string
  DAILY_EVENT_QUOTA?: string
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
  JOBS_VERSION?: string
  HEARTBEAT_URL?: string
  OPS_DISCORD_WEBHOOK_URL?: string
}

export type ScheduledEventLike = {
  cron: string
  scheduledTime: number
}

export type ExecutionContextLike = {
  waitUntil: (work: Promise<unknown>) => void
}

const REQUIRED: ReadonlyArray<keyof JobsEnv> = [
  'KEYS',
  'SPOOL',
  'CLICKHOUSE_URL',
  'CLICKHOUSE_DB',
  'CLICKHOUSE_JOBS_USER',
  'CLICKHOUSE_JOBS_PASSWORD',
]

export function dailyQuotaFrom(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  const quota = Number(value)
  if (!Number.isInteger(quota) || quota <= 0) {
    throw new Error(
      `DAILY_EVENT_QUOTA must be a positive whole number, got ${JSON.stringify(value)}`,
    )
  }
  return quota
}

export function assertEnv(env: Partial<JobsEnv>): JobsEnv {
  const missing = REQUIRED.filter((name) => {
    const value = env[name]
    return value === undefined || value === null || value === ''
  })
  if (missing.length > 0) {
    throw new Error(`The jobs worker is missing bindings: ${missing.join(', ')}`)
  }
  dailyQuotaFrom(env.DAILY_EVENT_QUOTA)
  return env as JobsEnv
}

export function buildJobTasks(env: JobsEnv): readonly Task[] {
  const dailyQuota = dailyQuotaFrom(env.DAILY_EVENT_QUOTA)

  return buildTasks(
    coreTaskDeps({
      spool: r2BlobStore(env.SPOOL),
      kv: env.KEYS,
      clickHouse: {
        url: env.CLICKHOUSE_URL,
        database: env.CLICKHOUSE_DB,
        user: env.CLICKHOUSE_JOBS_USER,
        password: env.CLICKHOUSE_JOBS_PASSWORD,
        ...(env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
          ? {
              accessClientId: env.CF_ACCESS_CLIENT_ID,
              accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
            }
          : {}),
      },
      ...(dailyQuota === undefined ? {} : { dailyQuota }),
      tellOperator: operatorNotifierFor(env),
    }),
  )
}

export function operatorNotifierFor(env: JobsEnv): (alert: OperatorAlert) => Promise<void> {
  return operatorNotifier({
    ...(env.OPS_DISCORD_WEBHOOK_URL === undefined
      ? {}
      : { webhookUrl: env.OPS_DISCORD_WEBHOOK_URL }),
    fetch: globalThis.fetch as never,
    environment: env.CLICKHOUSE_DB,
    onUndelivered: (alert, why) =>
      write('warn', '[nekolog/jobs] operator', JSON.stringify({ kind: alert.kind, why })),
  })
}

export type RunScheduledOptions = {
  tasks: readonly Task[]
  onSummary?: (summary: RunSummary) => void
  heartbeatUrl?: string
}

export async function runScheduled(
  event: ScheduledEventLike,
  options: RunScheduledOptions,
): Promise<RunSummary> {
  const summary = await runDueTasks(options.tasks, {
    scheduledAt: event.scheduledTime,
    cron: event.cron,
    onSummary: options.onSummary ?? writeSummary,
  })

  if (options.heartbeatUrl !== undefined && options.heartbeatUrl !== '') {
    await sendHeartbeat(summary, {
      url: options.heartbeatUrl,
      onProblem: (reason) => write('warn', '[nekolog/jobs] heartbeat', reason),
    })
  }

  return assertNoFailures(summary)
}

let cachedTasks: readonly Task[] | undefined
let cachedApp: Hono | undefined

function tasksFor(env: Partial<JobsEnv>): readonly Task[] {
  cachedTasks ??= buildJobTasks(assertEnv(env))
  return cachedTasks
}

export default {
  fetch(
    request: Request,
    env: Partial<JobsEnv>,
    ctx: ExecutionContextLike,
  ): Response | Promise<Response> {
    cachedApp ??= createJobsApp({
      taskCount: tasksFor(env).length,
      ...(env?.JOBS_VERSION ? { version: env.JOBS_VERSION } : {}),
    })
    return cachedApp.fetch(request, env, ctx as Parameters<Hono['fetch']>[2])
  },

  scheduled(
    event: ScheduledEventLike,
    env: Partial<JobsEnv>,
    ctx: ExecutionContextLike,
  ): Promise<RunSummary> {
    const work = runScheduled(event, {
      tasks: tasksFor(env),
      ...(env?.HEARTBEAT_URL ? { heartbeatUrl: env.HEARTBEAT_URL } : {}),
    })
    ctx.waitUntil(work)
    return work
  },
}

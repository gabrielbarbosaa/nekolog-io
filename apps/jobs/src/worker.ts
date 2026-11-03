import {
  type KvNamespace,
  kvQuotaStore,
  type R2BucketLike,
  r2BlobStore,
} from '@nekolog-io/adapters'
import { queryRows } from '@nekolog-io/clickhouse/client'
import { clickHouseLogStore } from '@nekolog-io/clickhouse/log-store'
import { clickHouseUsageStore } from '@nekolog-io/clickhouse/usage-store'
import type { Hono } from 'hono'
import { createJobsApp } from './app.ts'
import { sendHeartbeat } from './heartbeat.ts'
import { type RunSummary, runDueTasks } from './run.ts'
import type { Task } from './task.ts'
import type { CapacityAlert, DiskReading } from './tasks/capacity-watch.ts'
import type { QuotaBlockEvent } from './tasks/quota-block.ts'
import type { SpoolResendEvent } from './tasks/spool-resend.ts'
import { buildTasks } from './tasks.ts'

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

function write(level: 'log' | 'warn', ...args: unknown[]): void {
  const target = (
    globalThis as unknown as {
      console?: Record<string, ((...args: unknown[]) => void) | undefined>
    }
  ).console
  try {
    target?.[level]?.(...args)
  } catch {
    return
  }
}

export function writeSummary(summary: RunSummary): void {
  write('log', JSON.stringify({ app: 'nekolog/jobs', ...summary }))
}

export function writeSpoolEvent(event: SpoolResendEvent): void {
  if (event.kind === 'resent') {
    return
  }
  write('warn', '[nekolog/jobs] spool', JSON.stringify({ kind: event.kind, key: event.key }))
}

export function writeQuotaEvent(event: QuotaBlockEvent): void {
  write(
    'warn',
    '[nekolog/jobs] quota',
    JSON.stringify({
      kind: event.kind,
      environmentId: event.environmentId,
      events: event.events,
      quota: event.quota,
    }),
  )
}

export function writeCapacityAlert(alert: CapacityAlert): void {
  write('warn', '[nekolog/jobs] capacity', JSON.stringify(alert))
}

export function diskReaderFor(config: Parameters<typeof queryRows>[0]) {
  return async (signal: AbortSignal): Promise<DiskReading[]> => {
    const rows = await queryRows<{ name: string; free_space: string; total_space: string }>(
      config,
      'select name, free_space, total_space from system.disks',
      { fetch: (input, init) => fetch(input, { ...init, signal }) },
    )
    return rows.map((row) => ({
      name: row.name,
      freeBytes: Number(row.free_space),
      totalBytes: Number(row.total_space),
    }))
  }
}

export function buildJobTasks(env: JobsEnv): readonly Task[] {
  const clickHouse = {
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
  }
  const dailyQuota = dailyQuotaFrom(env.DAILY_EVENT_QUOTA)

  return buildTasks({
    spool: r2BlobStore(env.SPOOL),
    logStore: clickHouseLogStore(clickHouse),
    usage: clickHouseUsageStore(clickHouse),
    quotas: kvQuotaStore(env.KEYS),
    ...(dailyQuota === undefined ? {} : { dailyQuota }),
    onSpoolEvent: writeSpoolEvent,
    onQuotaEvent: writeQuotaEvent,
    readDisks: diskReaderFor(clickHouse),
    onCapacityAlert: writeCapacityAlert,
  })
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

import { fileBlobStore, fileKvNamespace } from '@internal/self-host'
import {
  type SqlRunner,
  sqlAlertChannelStore,
  sqlAlertNoticeStore,
  sqlAlertRuleStore,
  sqlIssueActivity,
  sqlIssueStore,
} from '@nekolog-io/adapters'
import { type ClickHouseConfig, queryRows } from '@nekolog-io/clickhouse/client'
import { clickHouseIssueSource } from '@nekolog-io/clickhouse/issues'
import { operatorNotifier } from './alerts/operator.ts'
import type { Task } from './task.ts'
import { buildTasks, type TaskDeps } from './tasks.ts'
import { coreTaskDeps, write } from './wiring.ts'
import { dailyQuotaFrom } from './worker.ts'

export const DEFAULT_JOBS_PORT = 8788

export type SelfHostJobsEnv = {
  CLICKHOUSE_URL?: string
  CLICKHOUSE_DB?: string
  CLICKHOUSE_JOBS_USER?: string
  CLICKHOUSE_JOBS_PASSWORD?: string
  DATABASE_URL?: string
  NEKOLOG_CONSOLE_URL?: string
  ENCRYPTION_KEY?: string
  SPOOL_DIR?: string
  KV_DIR?: string
  DAILY_EVENT_QUOTA?: string
  JOBS_PORT?: string
  JOBS_HOST?: string
  HEARTBEAT_URL?: string
  OPS_DISCORD_WEBHOOK_URL?: string
  JOBS_VERSION?: string
}

export type SelfHostJobsConfig = {
  clickHouse: ClickHouseConfig
  databaseUrl: string
  consoleUrl: string
  encryptionKey: string
  spoolDir: string
  kvDir: string
  port: number
  host: string
  dailyQuota?: number
  heartbeatUrl?: string
  opsWebhookUrl?: string
  version?: string
}

const REQUIRED: ReadonlyArray<keyof SelfHostJobsEnv> = [
  'CLICKHOUSE_URL',
  'CLICKHOUSE_DB',
  'CLICKHOUSE_JOBS_USER',
  'CLICKHOUSE_JOBS_PASSWORD',
  'DATABASE_URL',
  'NEKOLOG_CONSOLE_URL',
  'ENCRYPTION_KEY',
  'SPOOL_DIR',
  'KV_DIR',
]

export function portFrom(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_JOBS_PORT
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`JOBS_PORT must be a valid port, got ${JSON.stringify(value)}`)
  }
  return port
}

export function selfHostJobsConfigFrom(env: SelfHostJobsEnv): SelfHostJobsConfig {
  const missing = REQUIRED.filter((name) => {
    const value = env[name]
    return value === undefined || value === ''
  })
  if (missing.length > 0) {
    throw new Error(
      `The self-host jobs container is missing ${missing.join(', ')}. ` +
        'Copy deploy/self-host/.env.example to .env and fill every value in.',
    )
  }

  const dailyQuota = dailyQuotaFrom(env.DAILY_EVENT_QUOTA)

  return {
    clickHouse: {
      url: env.CLICKHOUSE_URL as string,
      database: env.CLICKHOUSE_DB as string,
      user: env.CLICKHOUSE_JOBS_USER as string,
      password: env.CLICKHOUSE_JOBS_PASSWORD as string,
    },
    databaseUrl: env.DATABASE_URL as string,
    consoleUrl: env.NEKOLOG_CONSOLE_URL as string,
    encryptionKey: env.ENCRYPTION_KEY as string,
    spoolDir: env.SPOOL_DIR as string,
    kvDir: env.KV_DIR as string,
    port: portFrom(env.JOBS_PORT),
    host: env.JOBS_HOST === undefined || env.JOBS_HOST === '' ? '0.0.0.0' : env.JOBS_HOST,
    ...(dailyQuota === undefined ? {} : { dailyQuota }),
    ...(env.HEARTBEAT_URL ? { heartbeatUrl: env.HEARTBEAT_URL } : {}),
    ...(env.OPS_DISCORD_WEBHOOK_URL ? { opsWebhookUrl: env.OPS_DISCORD_WEBHOOK_URL } : {}),
    ...(env.JOBS_VERSION ? { version: env.JOBS_VERSION } : {}),
  }
}

export type SelfHostJobsWiring = {
  config: SelfHostJobsConfig
  sql: SqlRunner
}

export function selfHostTaskDeps(wiring: SelfHostJobsWiring): TaskDeps {
  const { config, sql } = wiring
  const tellOperator = operatorNotifier({
    ...(config.opsWebhookUrl === undefined ? {} : { webhookUrl: config.opsWebhookUrl }),
    fetch: globalThis.fetch as never,
    environment: config.clickHouse.database,
    onUndelivered: (alert, why) =>
      write('warn', '[nekolog/jobs] operator', JSON.stringify({ kind: alert.kind, why })),
  })

  return {
    ...coreTaskDeps({
      spool: fileBlobStore(config.spoolDir),
      kv: fileKvNamespace(config.kvDir),
      clickHouse: config.clickHouse,
      ...(config.dailyQuota === undefined ? {} : { dailyQuota: config.dailyQuota }),
      tellOperator,
    }),
    issueSource: clickHouseIssueSource(config.clickHouse),
    issues: sqlIssueStore(sql),
    alertRules: sqlAlertRuleStore(sql),
    issueActivity: sqlIssueActivity(sql),
    alertTarget: { database: config.clickHouse.database },
    measureAlerts: (statement, params) => queryRows(config.clickHouse, statement, { params }),
    alertNotices: sqlAlertNoticeStore(sql),
    alertChannels: sqlAlertChannelStore(sql),
    alertDelivery: {
      fetch: globalThis.fetch as never,
      secretKey: config.encryptionKey,
      dashboardUrl: config.consoleUrl,
    },
    onAlertEvent: (event) => write('log', '[nekolog/jobs] alert', JSON.stringify(event)),
    onAlertNotifyEvent: (event) => write('log', '[nekolog/jobs] notify', JSON.stringify(event)),
  }
}

export function selfHostJobTasks(wiring: SelfHostJobsWiring): readonly Task[] {
  return buildTasks(selfHostTaskDeps(wiring))
}

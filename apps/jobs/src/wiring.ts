import type { BlobStore, KvNamespace } from '@nekolog-io/adapters'
import { kvQuotaStore } from '@nekolog-io/adapters'
import { type BackupDestination, backupHistoryQuery } from '@nekolog-io/clickhouse/backup'
import { type ClickHouseConfig, execute, queryRows } from '@nekolog-io/clickhouse/client'
import { clickHouseLogStore } from '@nekolog-io/clickhouse/log-store'
import { clickHouseUsageStore } from '@nekolog-io/clickhouse/usage-store'
import {
  backupAlert,
  capacityAlert,
  type OperatorAlert,
  quotaAlert,
  spoolAlert,
} from './alerts/operator.ts'
import type { RunSummary } from './run.ts'
import type { CapacityAlert, DiskReading } from './tasks/capacity-watch.ts'
import type {
  BackupHistoryReader,
  BackupStarter,
  ClickHouseBackupAlert,
} from './tasks/clickhouse-backup.ts'
import type { QuotaBlockEvent } from './tasks/quota-block.ts'
import type { SpoolResendEvent } from './tasks/spool-resend.ts'
import type { TaskDeps } from './tasks.ts'

export function write(level: 'log' | 'warn', ...args: unknown[]): void {
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

export function diskReaderFor(
  config: ClickHouseConfig,
): (signal: AbortSignal) => Promise<DiskReading[]> {
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

export function writeBackupAlert(alert: ClickHouseBackupAlert): void {
  write('warn', '[nekolog/jobs] backup', JSON.stringify(alert))
}

function within(signal: AbortSignal): typeof fetch {
  return ((input, init) => fetch(input, { ...init, signal })) as typeof fetch
}

export function backupHistoryReaderFor(config: ClickHouseConfig): BackupHistoryReader {
  return async (signal: AbortSignal) => {
    const rows = await queryRows<{
      name: string
      status: string
      error: string
      started_at: number
    }>(config, backupHistoryQuery(), { database: null, fetch: within(signal) })

    return rows.map((row) => ({
      name: row.name,
      status: row.status,
      error: row.error,
      startedAt: Number(row.started_at) * 1000,
    }))
  }
}

export function backupStarterFor(config: ClickHouseConfig): BackupStarter {
  return async (sql: string, signal: AbortSignal) => {
    await execute(config, sql, { database: null, fetch: within(signal) })
  }
}

export function raise(
  tell: (alert: OperatorAlert) => Promise<void>,
  alert: OperatorAlert | null,
): void {
  if (alert === null) {
    return
  }
  void tell(alert)
}

export type BackupWiring = {
  clickHouse: ClickHouseConfig
  destination: BackupDestination
}

export type CoreWiring = {
  spool: BlobStore
  kv: KvNamespace
  clickHouse: ClickHouseConfig
  dailyQuota?: number
  backup?: BackupWiring
  tellOperator: (alert: OperatorAlert) => Promise<void>
}

export type BackupDeps = Pick<
  TaskDeps,
  'backupDestination' | 'backupHistory' | 'startBackup' | 'onBackupAlert'
>

export function backupDeps(
  backup: BackupWiring | undefined,
  tellOperator: (alert: OperatorAlert) => Promise<void>,
): BackupDeps {
  if (backup === undefined) {
    return {}
  }
  return {
    backupDestination: backup.destination,
    backupHistory: backupHistoryReaderFor(backup.clickHouse),
    startBackup: backupStarterFor(backup.clickHouse),
    onBackupAlert: (alert: ClickHouseBackupAlert) => {
      writeBackupAlert(alert)
      raise(tellOperator, backupAlert(alert))
    },
  }
}

export function coreTaskDeps(wiring: CoreWiring): TaskDeps {
  const tellOperator = wiring.tellOperator

  return {
    ...backupDeps(wiring.backup, tellOperator),
    clickHouseDatabase: wiring.clickHouse.database,
    spool: wiring.spool,
    logStore: clickHouseLogStore(wiring.clickHouse),
    usage: clickHouseUsageStore(wiring.clickHouse),
    quotas: kvQuotaStore(wiring.kv),
    ...(wiring.dailyQuota === undefined ? {} : { dailyQuota: wiring.dailyQuota }),
    onSpoolEvent: (event) => {
      writeSpoolEvent(event)
      raise(tellOperator, spoolAlert(event))
    },
    onQuotaEvent: (event) => {
      writeQuotaEvent(event)
      raise(tellOperator, quotaAlert(event))
    },
    readDisks: diskReaderFor(wiring.clickHouse),
    onCapacityAlert: (alert) => {
      writeCapacityAlert(alert)
      raise(tellOperator, capacityAlert(alert))
    },
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

import {
  assertBackupTarget,
  BACKUP_CREATED,
  BACKUP_RUNNING,
  type BackupDestination,
  backupBaseUrl,
  compileBackup,
} from '@nekolog-io/clickhouse/backup'
import type { Task, TaskContext } from '../task.ts'
import { reasonFrom } from './export-run.ts'

export const CLICKHOUSE_BACKUP_TASK = 'clickhouse-backup'

export const DAY_MS = 86_400_000

export const DEFAULT_BACKUP_CHECK_MINUTES = 60

export type BackupAttempt = {
  name: string
  status: string
  error: string
  startedAt: number
}

export type BackupHistoryReader = (signal: AbortSignal) => Promise<BackupAttempt[]>

export type BackupStarter = (sql: string, signal: AbortSignal) => Promise<void>

export type ClickHouseBackupAlert =
  | { kind: 'history-unreadable'; why: string }
  | { kind: 'backup-failed'; why: string }
  | { kind: 'backup-unstarted'; why: string }

export type ClickHouseBackupReport = {
  state: 'running' | 'done' | 'started' | 'unstarted' | 'unreadable'
  attempts: number
  objectPrefix?: string
}

export type ClickHouseBackupOptions = {
  database: string
  destination: BackupDestination
  history: BackupHistoryReader
  start: BackupStarter
  periodMs?: number
  everyMinutes?: number
  onAlert?: (alert: ClickHouseBackupAlert) => void
}

export function periodStart(at: number, periodMs: number = DAY_MS): number {
  if (!Number.isInteger(periodMs) || periodMs < 60_000) {
    throw new Error(`A backup period of ${periodMs}ms is not a period`)
  }
  return Math.floor(at / periodMs) * periodMs
}

export function firstLineOf(value: unknown, secrets: readonly string[]): string {
  const text = value instanceof Error ? value.message : String(value)
  return reasonFrom(text.split('Stack trace')[0] ?? text, secrets)
}

export function clickHouseBackupTask(options: ClickHouseBackupOptions): Task {
  assertBackupTarget(options.database, options.destination)

  const base = backupBaseUrl(options.destination)
  const periodMs = options.periodMs ?? DAY_MS
  const announce = options.onAlert ?? (() => undefined)
  const secrets = [options.destination.secretAccessKey, options.destination.accessKeyId]

  return {
    name: CLICKHOUSE_BACKUP_TASK,
    everyMinutes: options.everyMinutes ?? DEFAULT_BACKUP_CHECK_MINUTES,

    async run(context: TaskContext): Promise<ClickHouseBackupReport> {
      let history: BackupAttempt[]

      try {
        history = await options.history(context.signal)
      } catch (error) {
        announce({ kind: 'history-unreadable', why: firstLineOf(error, secrets) })
        return { state: 'unreadable', attempts: 0 }
      }

      const since = periodStart(context.scheduledAt, periodMs)
      const mine = history.filter((one) => one.name.includes(base) && one.startedAt >= since)

      if (mine.some((one) => one.status === BACKUP_RUNNING)) {
        return { state: 'running', attempts: mine.length }
      }
      if (mine.some((one) => one.status === BACKUP_CREATED)) {
        return { state: 'done', attempts: mine.length }
      }

      const failures = mine
        .filter((one) => one.status !== BACKUP_RUNNING && one.status !== BACKUP_CREATED)
        .sort((left, right) => right.startedAt - left.startedAt)

      const newest = failures[0]
      if (newest !== undefined) {
        announce({ kind: 'backup-failed', why: firstLineOf(newest.error, secrets) })
      }

      try {
        const compiled = compileBackup({
          database: options.database,
          destination: options.destination,
          at: new Date(context.scheduledAt),
        })
        await options.start(compiled.sql, context.signal)
        return { state: 'started', attempts: mine.length + 1, objectPrefix: compiled.objectPrefix }
      } catch (error) {
        announce({ kind: 'backup-unstarted', why: firstLineOf(error, secrets) })
        return { state: 'unstarted', attempts: mine.length }
      }
    },
  }
}

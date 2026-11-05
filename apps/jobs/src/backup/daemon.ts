import type { BackupAlert, BackupReport, BackupRunOptions, Destination } from '@internal/backup'
import { runBackup, splitBucketUrl } from '@internal/backup'
import type { OperatorAlert } from '../alerts/operator.ts'

export const DEFAULT_CHECK_MINUTES = 30

export const MAX_DETAIL_CHARS = 300

export type BackupDaemonEnv = {
  DATABASE_URL?: string
  BACKUP_S3_ENDPOINT?: string
  BACKUP_S3_ACCESS_KEY_ID?: string
  BACKUP_S3_SECRET_ACCESS_KEY?: string
  BACKUP_AGE_RECIPIENT?: string
  BACKUP_ENVIRONMENT?: string
  BACKUP_KEEP_DAYS?: string
  BACKUP_CHECK_MINUTES?: string
}

export type BackupDaemonConfig = {
  environment: string
  databaseUrl: string
  recipient: string
  destination: Destination
  keepDays?: number
  checkMinutes: number
}

export const REQUIRED: ReadonlyArray<keyof BackupDaemonEnv> = [
  'DATABASE_URL',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_AGE_RECIPIENT',
]

export const NOTHING_TO_DO =
  '[nekolog/backup] no destination and no age recipient: the Postgres is not backed up. ' +
  'Set BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY and ' +
  'BACKUP_AGE_RECIPIENT to change that.'

function positive(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a whole number of at least 1, got ${JSON.stringify(value)}`)
  }
  return parsed
}

export function backupDaemonConfigFrom(env: BackupDaemonEnv): BackupDaemonConfig | undefined {
  const given = REQUIRED.filter((name) => {
    const value = env[name]
    return value !== undefined && value !== ''
  })

  if (given.length === 0) {
    return undefined
  }
  if (given.length !== REQUIRED.length) {
    const missing = REQUIRED.filter((name) => !given.includes(name))
    throw new Error(
      `The Postgres backup is half configured: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing. ` +
        'Fill all of them in, or leave all of them out and accept that the Postgres has no backup.',
    )
  }

  const bucketUrl = env.BACKUP_S3_ENDPOINT as string
  splitBucketUrl(bucketUrl)

  const keepDays = positive('BACKUP_KEEP_DAYS', env.BACKUP_KEEP_DAYS)

  return {
    environment:
      env.BACKUP_ENVIRONMENT === undefined || env.BACKUP_ENVIRONMENT === ''
        ? 'prod'
        : env.BACKUP_ENVIRONMENT,
    databaseUrl: env.DATABASE_URL as string,
    recipient: env.BACKUP_AGE_RECIPIENT as string,
    destination: {
      bucketUrl,
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY as string,
    },
    ...(keepDays === undefined ? {} : { keepDays }),
    checkMinutes:
      positive('BACKUP_CHECK_MINUTES', env.BACKUP_CHECK_MINUTES) ?? DEFAULT_CHECK_MINUTES,
  }
}

export function backupOperatorAlert(alert: BackupAlert): OperatorAlert {
  const headline =
    alert.kind === 'listing-unreadable'
      ? 'Cannot tell whether the Postgres is being backed up'
      : alert.kind === 'dump-failed'
        ? 'The Postgres backup failed'
        : 'Old Postgres backups could not be deleted'

  return {
    severity: alert.kind === 'prune-failed' ? 'warning' : 'critical',
    kind: alert.kind,
    headline,
    detail: alert.why.slice(0, MAX_DETAIL_CHARS),
  }
}

export type BackupCycleOptions = {
  config: BackupDaemonConfig
  tellOperator: (alert: OperatorAlert) => Promise<void>
  onReport?: (report: BackupReport) => void
  now?: () => number
  run?: BackupRunOptions['run']
  signal?: AbortSignal
}

export async function runBackupCycle(options: BackupCycleOptions): Promise<BackupReport> {
  const { config } = options

  const report = await runBackup({
    environment: config.environment,
    databaseUrl: config.databaseUrl,
    recipient: config.recipient,
    destination: config.destination,
    ...(config.keepDays === undefined ? {} : { keepDays: config.keepDays }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.run === undefined ? {} : { run: options.run }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onAlert: (alert) => {
      void options.tellOperator(backupOperatorAlert(alert))
    },
  })

  options.onReport?.(report)
  return report
}

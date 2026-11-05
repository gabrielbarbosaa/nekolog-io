import { REDACTED, sqlText, withoutTrailingSlashes } from './export.ts'
import { assertIdentifier } from './log-store.ts'

export const BACKUP_KEY_PREFIX = 'clickhouse/'

export const BACKUP_RUNNING = 'CREATING_BACKUP'
export const BACKUP_CREATED = 'BACKUP_CREATED'
export const BACKUP_FAILED = 'BACKUP_FAILED'
export const BACKUP_CANCELLED = 'BACKUP_CANCELLED'

export const BACKUP_STATUSES: readonly string[] = [
  BACKUP_RUNNING,
  BACKUP_CREATED,
  BACKUP_FAILED,
  BACKUP_CANCELLED,
]

export const BACKUP_HISTORY_LIMIT = 50

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/

export type BackupDestination = {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
}

export type BackupRequest = {
  database: string
  destination: BackupDestination
  at: Date
}

export type CompiledBackup = {
  sql: string
  redacted: string
  url: string
  objectPrefix: string
}

export function backupStamp(at: Date): string {
  if (Number.isNaN(at.getTime())) {
    throw new Error('Refusing to name a backup from an invalid date')
  }
  return at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')
}

export function backupObjectPrefix(at: Date): string {
  return `${BACKUP_KEY_PREFIX}${backupStamp(at)}`
}

export function isBackupObjectPrefix(value: string): boolean {
  return value.startsWith(BACKUP_KEY_PREFIX) && STAMP.test(value.slice(BACKUP_KEY_PREFIX.length))
}

export function backupBaseUrl(destination: BackupDestination): string {
  const endpoint = withoutTrailingSlashes(destination.endpoint)
  if (!/^https?:\/\/[^\s'"\\]+$/.test(endpoint)) {
    throw new Error('Refusing to back up to an endpoint that is not a plain http or https address')
  }
  return `${endpoint}/${BACKUP_KEY_PREFIX}`
}

export function assertBackupTarget(database: string, destination: BackupDestination): string {
  const checked = assertIdentifier(database, 'database name')

  if (destination.accessKeyId === '' || destination.secretAccessKey === '') {
    throw new Error('Refusing to back up without credentials for the destination')
  }
  backupBaseUrl(destination)

  return checked
}

export function compileBackup(request: BackupRequest): CompiledBackup {
  const database = assertBackupTarget(request.database, request.destination)
  const objectPrefix = backupObjectPrefix(request.at)
  const url = `${backupBaseUrl(request.destination)}${backupStamp(request.at)}`

  const statement = (key: string, secret: string): string =>
    `BACKUP DATABASE ${database} TO S3(${sqlText(url)}, ${sqlText(key)}, ${sqlText(secret)}) ` +
    'SETTINGS async = 1'

  return {
    sql: statement(request.destination.accessKeyId, request.destination.secretAccessKey),
    redacted: statement(REDACTED, REDACTED),
    url,
    objectPrefix,
  }
}

export function backupHistoryQuery(limit: number = BACKUP_HISTORY_LIMIT): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error(`Refusing to read ${limit} rows of backup history`)
  }
  return (
    'SELECT name, status, error, toUnixTimestamp(start_time) AS started_at ' +
    'FROM system.backups ORDER BY start_time DESC ' +
    `LIMIT ${limit}`
  )
}

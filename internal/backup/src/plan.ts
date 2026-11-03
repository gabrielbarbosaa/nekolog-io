export const BACKUP_PREFIX = 'postgres/'

export const BACKUP_SUFFIX = '.sql.gz.age'

export const DEFAULT_KEEP_DAYS = 30

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/

export class BackupRefused extends Error {
  constructor(reason: string) {
    super(`Refusing to run this backup: ${reason}`)
    this.name = 'BackupRefused'
  }
}

export function stampFor(at: Date): string {
  if (Number.isNaN(at.getTime())) {
    throw new BackupRefused('the clock gave an invalid date')
  }
  return at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')
}

export function keyFor(environment: string, at: Date): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(environment)) {
    throw new BackupRefused(`"${environment}" is not an environment name`)
  }
  return `${BACKUP_PREFIX}${environment}/${stampFor(at)}${BACKUP_SUFFIX}`
}

export function isBackupKey(key: string): boolean {
  if (!key.startsWith(BACKUP_PREFIX) || !key.endsWith(BACKUP_SUFFIX)) {
    return false
  }
  const rest = key.slice(BACKUP_PREFIX.length, -BACKUP_SUFFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || rest.indexOf('/', slash + 1) !== -1) {
    return false
  }
  return STAMP.test(rest.slice(slash + 1))
}

export function takenAt(key: string): Date | null {
  if (!isBackupKey(key)) {
    return null
  }
  const stamp = key.slice(BACKUP_PREFIX.length, -BACKUP_SUFFIX.length).split('/')[1] ?? ''
  const [date, time] = [stamp.slice(0, 10), stamp.slice(11, 19).replace(/-/g, ':')]
  const at = new Date(`${date}T${time}Z`)
  return Number.isNaN(at.getTime()) ? null : at
}

export type ExpiryOptions = {
  now: Date
  keepDays?: number
}

export function expired(keys: readonly string[], options: ExpiryOptions): string[] {
  const keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS
  if (!Number.isInteger(keepDays) || keepDays < 1) {
    throw new BackupRefused(`keeping backups for ${keepDays} days is not a retention`)
  }

  const survivors = keys.filter(isBackupKey)
  const oldest = options.now.getTime() - keepDays * 24 * 60 * 60 * 1000

  const doomed = survivors.filter((key) => {
    const at = takenAt(key)
    return at !== null && at.getTime() < oldest
  })

  if (doomed.length === survivors.length && survivors.length > 0) {
    throw new BackupRefused(
      'every backup looks expired, which is what a wrong clock looks like; nothing was deleted',
    )
  }

  return doomed
}

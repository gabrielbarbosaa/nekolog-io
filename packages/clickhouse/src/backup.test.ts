import { describe, expect, it } from 'vitest'
import {
  BACKUP_CREATED,
  BACKUP_HISTORY_LIMIT,
  BACKUP_KEY_PREFIX,
  backupBaseUrl,
  backupHistoryQuery,
  backupObjectPrefix,
  backupStamp,
  compileBackup,
  isBackupObjectPrefix,
} from './backup.ts'

const destination = {
  endpoint: 'http://garage:3900/nekolog-dev',
  accessKeyId: 'GK31c2f218a2e44f485b94239e',
  secretAccessKey: 'b0e7a4c21d8f5639ae0c47b2f81d3a6950c8e2b47f1a9d3c6e05b8a2f47c91d3',
}

const at = new Date('2026-11-05T03:00:00.000Z')

describe('naming a backup', () => {
  it('writes the moment it was taken, with no character a path has to escape', () => {
    expect(backupStamp(at)).toBe('2026-11-05T03-00-00Z')
    expect(backupObjectPrefix(at)).toBe('clickhouse/2026-11-05T03-00-00Z')
  })

  it('gives every attempt a name of its own, so a retry never lands on a half-written one', () => {
    const first = backupObjectPrefix(at)
    const second = backupObjectPrefix(new Date(at.getTime() + 3_600_000))

    expect(second).not.toBe(first)
  })

  it('refuses a date that is not one', () => {
    expect(() => backupStamp(new Date('nonsense'))).toThrow(/invalid date/)
  })

  it('recognises its own names and nothing else', () => {
    expect(isBackupObjectPrefix('clickhouse/2026-11-05T03-00-00Z')).toBe(true)
    expect(isBackupObjectPrefix('clickhouse/2026-11-05T03:00:00Z')).toBe(false)
    expect(isBackupObjectPrefix('postgres/2026-11-05T03-00-00Z')).toBe(false)
    expect(isBackupObjectPrefix('clickhouse/whatever')).toBe(false)
  })
})

describe('the backup statement', () => {
  it('names the database, the destination and asks for the asynchronous form', () => {
    const compiled = compileBackup({ database: 'nekolog', destination, at })

    expect(compiled.sql).toBe(
      "BACKUP DATABASE nekolog TO S3('http://garage:3900/nekolog-dev/clickhouse/2026-11-05T03-00-00Z', " +
        `'${destination.accessKeyId}', '${destination.secretAccessKey}') SETTINGS async = 1`,
    )
    expect(compiled.objectPrefix).toBe('clickhouse/2026-11-05T03-00-00Z')
  })

  it('carries a form with no credentials in it, for anything that gets logged', () => {
    const compiled = compileBackup({ database: 'nekolog', destination, at })

    expect(compiled.redacted).not.toContain(destination.accessKeyId)
    expect(compiled.redacted).not.toContain(destination.secretAccessKey)
    expect(compiled.redacted).toContain('[redacted]')
    expect(compiled.redacted).toContain(compiled.url)
  })

  it('escapes a credential instead of letting it close the string it sits in', () => {
    const compiled = compileBackup({
      database: 'nekolog',
      destination: { ...destination, secretAccessKey: "x') SETTINGS async = 0 -- " },
      at,
    })

    expect(compiled.sql).toContain("\\') SETTINGS async = 0 -- ")
    expect(compiled.sql.endsWith('SETTINGS async = 1')).toBe(true)
  })

  it('refuses a database name it would have to interpolate blindly', () => {
    expect(() => compileBackup({ database: 'nekolog; DROP', destination, at })).toThrow(
      /unsafe database name/,
    )
  })

  it('refuses a destination that is not a plain http or https address', () => {
    for (const endpoint of ['file:///etc', 's3://bucket', 'http://host/a b', '']) {
      expect(() =>
        compileBackup({ database: 'nekolog', destination: { ...destination, endpoint }, at }),
      ).toThrow(/plain http or https/)
    }
  })

  it('refuses to write a backup anonymously, which would be a public object', () => {
    expect(() =>
      compileBackup({ database: 'nekolog', destination: { ...destination, accessKeyId: '' }, at }),
    ).toThrow(/without credentials/)
    expect(() =>
      compileBackup({
        database: 'nekolog',
        destination: { ...destination, secretAccessKey: '' },
        at,
      }),
    ).toThrow(/without credentials/)
  })

  it('drops a trailing slash instead of writing a double one into the key', () => {
    expect(backupBaseUrl({ ...destination, endpoint: 'http://garage:3900/nekolog-dev//' })).toBe(
      `http://garage:3900/nekolog-dev/${BACKUP_KEY_PREFIX}`,
    )
  })
})

describe('reading the history back', () => {
  it('asks for the moment as a number, never as a string a timezone can move', () => {
    expect(backupHistoryQuery()).toContain('toUnixTimestamp(start_time) AS started_at')
    expect(backupHistoryQuery()).toContain(`LIMIT ${BACKUP_HISTORY_LIMIT}`)
    expect(backupHistoryQuery()).toContain('ORDER BY start_time DESC')
  })

  it('refuses a limit that is not one', () => {
    for (const limit of [0, -1, 1.5, 1001]) {
      expect(() => backupHistoryQuery(limit)).toThrow(/rows of backup history/)
    }
  })

  it('knows the status ClickHouse uses for a finished backup', () => {
    expect(BACKUP_CREATED).toBe('BACKUP_CREATED')
  })
})

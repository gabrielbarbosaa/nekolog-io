import { describe, expect, it } from 'vitest'
import { describePipeline, dumpCommand, restoreCommand } from './commands.ts'
import {
  BACKUP_PREFIX,
  BackupRefused,
  DEFAULT_KEEP_DAYS,
  expired,
  isBackupKey,
  keyFor,
  stampFor,
  takenAt,
} from './plan.ts'

const AT = new Date('2026-11-03T04:05:06.789Z')
const KEY = `${BACKUP_PREFIX}prod/2026-11-03T04-05-06Z.sql.gz.age`

describe('where a backup lands', () => {
  it('names it by environment and by the second it was taken', () => {
    expect(keyFor('prod', AT)).toBe(KEY)
  })

  it('uses a stamp that sorts the same as time', () => {
    const earlier = stampFor(new Date('2026-11-03T04:05:05Z'))

    expect(stampFor(AT) > earlier).toBe(true)
  })

  it('reads back the moment it wrote', () => {
    expect(takenAt(KEY)?.toISOString()).toBe('2026-11-03T04:05:06.000Z')
  })

  it.each(['../../etc/passwd', 'PROD', 'prod/qa', ''])('refuses %j as an environment', (name) => {
    expect(() => keyFor(name, AT)).toThrow(BackupRefused)
  })

  it.each([
    'postgres/prod/2026-11-03T04-05-06Z.sql.gz',
    'postgres/prod/yesterday.sql.gz.age',
    'postgres/2026-11-03T04-05-06Z.sql.gz.age',
    'postgres/prod/nested/2026-11-03T04-05-06Z.sql.gz.age',
    'exports/prod/2026-11-03T04-05-06Z.sql.gz.age',
  ])('does not mistake %j for a backup', (key) => {
    expect(isBackupKey(key)).toBe(false)
    expect(takenAt(key)).toBeNull()
  })
})

describe('what expires', () => {
  const now = new Date('2026-12-03T00:00:00Z')
  const fresh = keyFor('prod', new Date('2026-12-02T00:00:00Z'))
  const old = keyFor('prod', new Date('2026-10-01T00:00:00Z'))

  it('deletes only what is past the retention', () => {
    expect(expired([fresh, old], { now })).toEqual([old])
  })

  it('leaves alone an object that is not a backup of ours', () => {
    expect(expired([fresh, 'postgres/prod/notes.txt'], { now })).toEqual([])
  })

  it('refuses to delete everything, which is what a wrong clock looks like', () => {
    expect(() => expired([old], { now })).toThrow(BackupRefused)
  })

  it('does not let an unrelated object make the last backup look expendable', () => {
    expect(() => expired([old, 'postgres/prod/notes.txt'], { now })).toThrow(BackupRefused)
  })

  it('says nothing to do when there is nothing stored yet', () => {
    expect(expired([], { now })).toEqual([])
  })

  it.each([0, -1, 1.5])('refuses %j as a retention', (keepDays) => {
    expect(() => expired([fresh, old], { now, keepDays })).toThrow(BackupRefused)
  })

  it('keeps a month by default', () => {
    expect(DEFAULT_KEEP_DAYS).toBe(30)
  })
})

describe('the commands', () => {
  const dump = { databaseUrl: 'postgres://nekolog:secret@db.test/nekolog', recipient: 'age1abc' }

  it('pipes the dump through gzip into age, so nothing lands unencrypted', () => {
    expect(describePipeline(dumpCommand(dump))).toBe(
      'pg_dump --no-owner --no-privileges --format=plain | gzip --best --stdout | age --recipient age1abc',
    )
  })

  it('keeps the connection string out of the arguments, where any process can read it', () => {
    for (const step of dumpCommand(dump)) {
      expect(step.args.join(' ')).not.toContain('secret')
    }
    expect(dumpCommand(dump)[0]?.env.PGDATABASE).toBe(dump.databaseUrl)
  })

  it('refuses to run with no recipient, instead of writing a readable dump', () => {
    expect(() => dumpCommand({ ...dump, recipient: '  ' })).toThrow(BackupRefused)
  })

  it('refuses to run with no database', () => {
    expect(() => dumpCommand({ ...dump, databaseUrl: '' })).toThrow(BackupRefused)
  })

  it('restores by decrypting first and stops the restore at the first error', () => {
    const pipeline = restoreCommand({ databaseUrl: dump.databaseUrl, identityFile: '/run/key' })

    expect(pipeline[0]?.file).toBe('age')
    expect(describePipeline(pipeline)).toContain('ON_ERROR_STOP=1')
  })

  it('refuses to restore without an identity', () => {
    expect(() => restoreCommand({ databaseUrl: dump.databaseUrl, identityFile: '' })).toThrow(
      BackupRefused,
    )
  })
})

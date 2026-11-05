import { describe, expect, it } from 'vitest'
import {
  deleteCommand,
  describePipeline,
  dumpCommand,
  listCommand,
  pgEnvFrom,
  rcloneEnv,
  restoreCommand,
  uploadCommand,
} from './commands.ts'
import {
  BACKUP_PREFIX,
  BackupRefused,
  DEFAULT_KEEP_DAYS,
  expired,
  isBackupKey,
  keyFor,
  splitBucketUrl,
  stampFor,
  takenAt,
} from './plan.ts'

const DESTINATION = {
  bucketUrl: 'https://account.r2.cloudflarestorage.com/nekolog-backups',
  accessKeyId: 'GK31c2f218a2e44f485b94239e',
  secretAccessKey: 'b0e7a4c21d8f5639ae0c47b2f81d3a6950c8e2b47f1a9d3c6e05b8a2f47c91d3',
}

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
    expect(dumpCommand(dump)[0]?.env.PGPASSWORD).toBe('secret')
  })

  it('hands libpq its own variables, because PGDATABASE is a name and not a URI', () => {
    expect(dumpCommand(dump)[0]?.env).toEqual({
      PGHOST: 'db.test',
      PGPORT: '5432',
      PGDATABASE: 'nekolog',
      PGUSER: 'nekolog',
      PGPASSWORD: 'secret',
    })
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

describe('reading a connection string', () => {
  it('takes the port, the database and an ssl mode from the url', () => {
    expect(pgEnvFrom('postgresql://u:p@host:6543/neondb?sslmode=require')).toEqual({
      PGHOST: 'host',
      PGPORT: '6543',
      PGDATABASE: 'neondb',
      PGUSER: 'u',
      PGPASSWORD: 'p',
      PGSSLMODE: 'require',
    })
  })

  it('decodes what the url had to escape, or the password is the wrong one', () => {
    expect(pgEnvFrom('postgres://a%40b:p%40ss%2Fword@host/db')).toMatchObject({
      PGUSER: 'a@b',
      PGPASSWORD: 'p@ss/word',
    })
  })

  it('leaves out what the url does not carry, instead of inventing a blank', () => {
    expect(pgEnvFrom('postgres://host/db')).toEqual({
      PGHOST: 'host',
      PGPORT: '5432',
      PGDATABASE: 'db',
    })
  })

  it('refuses anything that is not a postgres connection string', () => {
    for (const url of ['', 'not a url', 'mysql://host/db', 'postgres://host', 'postgres:///db']) {
      expect(() => pgEnvFrom(url), url).toThrow(BackupRefused)
    }
  })
})

describe('the address of the bucket', () => {
  it('splits an endpoint from a bucket name, and drops a trailing slash', () => {
    expect(splitBucketUrl('https://host/nekolog-backups/')).toEqual({
      endpoint: 'https://host',
      bucket: 'nekolog-backups',
    })
  })

  it('refuses anything that is not exactly host plus one bucket', () => {
    for (const url of [
      'https://host',
      'https://host/bucket/prefix',
      's3://host/bucket',
      'https://host/-bucket',
      '',
    ]) {
      expect(() => splitBucketUrl(url), url).toThrow(BackupRefused)
    }
  })
})

describe('talking to the bucket', () => {
  it('configures the remote through the environment, never through an argument', () => {
    const upload = uploadCommand(DESTINATION, 'postgres/prod/x.sql.gz.age')

    expect(upload.args.join(' ')).not.toContain(DESTINATION.secretAccessKey)
    expect(upload.env.RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY).toBe(DESTINATION.secretAccessKey)
    expect(upload.env.RCLONE_CONFIG_BACKUP_ENDPOINT).toBe(
      'https://account.r2.cloudflarestorage.com',
    )
    expect(upload.env.RCLONE_CONFIG_BACKUP_TYPE).toBe('s3')
  })

  it('streams the dump straight in, with no file on the way', () => {
    expect(uploadCommand(DESTINATION, 'postgres/prod/x.sql.gz.age').args).toEqual([
      'rcat',
      'backup:nekolog-backups/postgres/prod/x.sql.gz.age',
    ])
  })

  it('lists one environment and nothing else', () => {
    expect(listCommand(DESTINATION, 'prod').args).toEqual([
      'lsf',
      '--recursive',
      '--files-only',
      'backup:nekolog-backups/postgres/prod/',
    ])
  })

  it('deletes one named file, never a folder', () => {
    expect(deleteCommand(DESTINATION, 'postgres/prod/x.sql.gz.age').args[0]).toBe('deletefile')
  })

  it('refuses to talk to the bucket without credentials', () => {
    expect(() => rcloneEnv({ ...DESTINATION, secretAccessKey: ' ' })).toThrow(BackupRefused)
    expect(() => rcloneEnv({ ...DESTINATION, accessKeyId: '' })).toThrow(BackupRefused)
  })

  it('signs as us-east-1 unless told otherwise, which is what every S3 expects', () => {
    expect(rcloneEnv(DESTINATION).RCLONE_CONFIG_BACKUP_REGION).toBe('us-east-1')
    expect(rcloneEnv({ ...DESTINATION, region: 'auto' }).RCLONE_CONFIG_BACKUP_REGION).toBe('auto')
  })
})

import type { Command } from '@internal/backup'
import { describe, expect, it } from 'vitest'
import type { OperatorAlert } from '../alerts/operator.ts'
import {
  type BackupDaemonEnv,
  backupDaemonConfigFrom,
  backupOperatorAlert,
  DEFAULT_CHECK_MINUTES,
  NOTHING_TO_DO,
  REQUIRED,
  runBackupCycle,
} from './daemon.ts'

function envFor(): BackupDaemonEnv {
  return {
    DATABASE_URL: 'postgres://nekolog:nekolog@postgres:5432/nekolog',
    BACKUP_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com/nekolog-backups',
    BACKUP_S3_ACCESS_KEY_ID: 'GK31c2f218a2e44f485b94239e',
    BACKUP_S3_SECRET_ACCESS_KEY: 'b'.repeat(64),
    BACKUP_AGE_RECIPIENT: 'age1examplerecipient',
  }
}

describe('the configuration the backup container reads', () => {
  it('stays off when nobody asked for it, and says what would turn it on', () => {
    expect(backupDaemonConfigFrom({})).toBeUndefined()
    for (const name of REQUIRED) {
      expect(NOTHING_TO_DO).toContain(name === 'DATABASE_URL' ? 'Postgres' : name)
    }
  })

  it.each(REQUIRED)('refuses to start with %s missing from the rest', (name) => {
    expect(() => backupDaemonConfigFrom({ ...envFor(), [name]: undefined })).toThrow(
      new RegExp(`half configured: .*${name}`),
    )
  })

  it('refuses a destination that is not one host and one bucket', () => {
    expect(() =>
      backupDaemonConfigFrom({ ...envFor(), BACKUP_S3_ENDPOINT: 'https://host/bucket/prefix' }),
    ).toThrow(/bucket address/)
  })

  it('keeps thirty days and checks twice an hour unless told otherwise', () => {
    const config = backupDaemonConfigFrom(envFor())

    expect(config?.keepDays).toBeUndefined()
    expect(config?.checkMinutes).toBe(DEFAULT_CHECK_MINUTES)
    expect(config?.environment).toBe('prod')
  })

  it.each(['0', '-1', '2.5', 'soon'])('refuses %s as a number of days or minutes', (value) => {
    expect(() => backupDaemonConfigFrom({ ...envFor(), BACKUP_KEEP_DAYS: value })).toThrow(
      /BACKUP_KEEP_DAYS/,
    )
    expect(() => backupDaemonConfigFrom({ ...envFor(), BACKUP_CHECK_MINUTES: value })).toThrow(
      /BACKUP_CHECK_MINUTES/,
    )
  })
})

describe('how a backup problem reaches an operator', () => {
  it('treats a failed backup and a failed measurement as critical', () => {
    expect(backupOperatorAlert({ kind: 'dump-failed', why: 'x' }).severity).toBe('critical')
    expect(backupOperatorAlert({ kind: 'listing-unreadable', why: 'x' }).severity).toBe('critical')
  })

  it('treats a backup that was written but not pruned as a warning, because it exists', () => {
    expect(backupOperatorAlert({ kind: 'prune-failed', why: 'x' }).severity).toBe('warning')
  })

  it('names the problem in a sentence somebody woken at night can read', () => {
    expect(backupOperatorAlert({ kind: 'dump-failed', why: 'x' }).headline).toBe(
      'The Postgres backup failed',
    )
  })
})

describe('one cycle of the container', () => {
  it('tells the operator when the bucket cannot be read, and runs nothing else', async () => {
    const told: OperatorAlert[] = []
    const ran: Command[][] = []

    const report = await runBackupCycle({
      config: backupDaemonConfigFrom(envFor()) as NonNullable<
        ReturnType<typeof backupDaemonConfigFrom>
      >,
      tellOperator: async (alert) => {
        told.push(alert)
      },
      run: async (steps) => {
        ran.push([...steps])
        throw new Error('rclone: AccessDenied')
      },
    })

    expect(report.state).toBe('unreadable')
    expect(ran).toHaveLength(1)
    expect(told[0]?.kind).toBe('listing-unreadable')
    expect(told[0]?.severity).toBe('critical')
  })

  it('reports what it wrote when everything worked', async () => {
    const told: OperatorAlert[] = []

    const report = await runBackupCycle({
      config: backupDaemonConfigFrom(envFor()) as NonNullable<
        ReturnType<typeof backupDaemonConfigFrom>
      >,
      tellOperator: async (alert) => {
        told.push(alert)
      },
      now: () => Date.parse('2026-11-05T04:00:00.000Z'),
      run: async () => ({ stdout: '', stderr: '' }),
    })

    expect(report.state).toBe('written')
    expect(report.key).toBe('postgres/prod/2026-11-05T04-00-00Z.sql.gz.age')
    expect(told).toEqual([])
  })
})

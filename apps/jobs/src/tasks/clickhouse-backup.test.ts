import { describe, expect, it } from 'vitest'
import {
  type BackupAttempt,
  type ClickHouseBackupAlert,
  type ClickHouseBackupReport,
  clickHouseBackupTask,
  DAY_MS,
  periodStart,
} from './clickhouse-backup.ts'

const SECRET = 'b0e7a4c21d8f5639ae0c47b2f81d3a6950c8e2b47f1a9d3c6e05b8a2f47c91d3'
const KEY = 'GK31c2f218a2e44f485b94239e'

const destination = {
  endpoint: 'http://garage:3900/nekolog-dev',
  accessKeyId: KEY,
  secretAccessKey: SECRET,
}

const SCHEDULED = Date.parse('2026-11-05T04:00:00.000Z')
const EARLIER_TODAY = Date.parse('2026-11-05T03:00:00.000Z')
const YESTERDAY = Date.parse('2026-11-04T03:00:00.000Z')

const OURS = 'http://garage:3900/nekolog-dev/clickhouse/'

function attempt(overrides: Partial<BackupAttempt> = {}): BackupAttempt {
  return {
    name: `S3('${OURS}2026-11-05T03-00-00Z', '${KEY}', '[HIDDEN]')`,
    status: 'BACKUP_CREATED',
    error: '',
    startedAt: EARLIER_TODAY,
    ...overrides,
  }
}

type Run = {
  report: ClickHouseBackupReport
  started: string[]
  alerts: ClickHouseBackupAlert[]
}

async function run(
  history: BackupAttempt[] | Error,
  options: { start?: () => Promise<void> } = {},
): Promise<Run> {
  const started: string[] = []
  const alerts: ClickHouseBackupAlert[] = []

  const task = clickHouseBackupTask({
    database: 'nekolog_dev',
    destination,
    history: async () => {
      if (history instanceof Error) {
        throw history
      }
      return history
    },
    start: async (sql) => {
      started.push(sql)
      await options.start?.()
    },
    onAlert: (alert) => alerts.push(alert),
  })

  const report = (await task.run({
    scheduledAt: SCHEDULED,
    cron: '* * * * *',
    signal: new AbortController().signal,
  })) as ClickHouseBackupReport

  return { report, started, alerts }
}

describe('deciding whether today already has a backup', () => {
  it('cuts the period at UTC midnight, so one calendar day gets one backup', () => {
    expect(periodStart(SCHEDULED)).toBe(Date.parse('2026-11-05T00:00:00.000Z'))
    expect(periodStart(SCHEDULED, DAY_MS)).toBe(periodStart(SCHEDULED))
  })

  it('refuses a period that is shorter than the cron that checks it', () => {
    expect(() => periodStart(SCHEDULED, 1000)).toThrow(/not a period/)
  })
})

describe('the clickhouse backup task', () => {
  it('starts one when the day has none', async () => {
    const { report, started, alerts } = await run([])

    expect(report.state).toBe('started')
    expect(report.objectPrefix).toBe('clickhouse/2026-11-05T04-00-00Z')
    expect(started).toHaveLength(1)
    expect(started[0]).toContain('BACKUP DATABASE nekolog_dev TO S3')
    expect(alerts).toEqual([])
  })

  it('names the backup after the moment the cron woke, never after wall clock drift', async () => {
    const { started } = await run([])

    expect(started[0]).toContain(`${OURS}2026-11-05T04-00-00Z`)
  })

  it('leaves a running backup alone instead of starting a second one', async () => {
    const { report, started } = await run([attempt({ status: 'CREATING_BACKUP' })])

    expect(report.state).toBe('running')
    expect(started).toEqual([])
  })

  it('does nothing once the day has a finished backup', async () => {
    const { report, started } = await run([attempt()])

    expect(report.state).toBe('done')
    expect(started).toEqual([])
  })

  it('does not count yesterday’s success as today’s backup', async () => {
    const { report, started } = await run([attempt({ startedAt: YESTERDAY })])

    expect(report.state).toBe('started')
    expect(started).toHaveLength(1)
  })

  it('ignores a backup written by somebody else to another destination', async () => {
    const other = attempt({ name: "S3('http://elsewhere/clickhouse/x', 'k', '[HIDDEN]')" })
    const { report, started } = await run([other])

    expect(report.state).toBe('started')
    expect(started).toHaveLength(1)
  })

  it('raises the failure and tries again in the same run', async () => {
    const { report, started, alerts } = await run([
      attempt({ status: 'BACKUP_FAILED', error: 'Code: 499. DB::Exception: no route to host' }),
    ])

    expect(alerts).toEqual([
      { kind: 'backup-failed', why: 'Code: 499. DB::Exception: no route to host' },
    ])
    expect(report.state).toBe('started')
    expect(started).toHaveLength(1)
  })

  it('reports the newest failure, not the first one of the day', async () => {
    const { alerts } = await run([
      attempt({ status: 'BACKUP_FAILED', error: 'older', startedAt: EARLIER_TODAY }),
      attempt({
        status: 'BACKUP_FAILED',
        error: 'newer',
        startedAt: EARLIER_TODAY + 60_000,
      }),
    ])

    expect(alerts[0]).toEqual({ kind: 'backup-failed', why: 'newer' })
  })

  it('cuts the stack trace off the reason, which is a page of addresses', async () => {
    const { alerts } = await run([
      attempt({
        status: 'BACKUP_FAILED',
        error: 'Disk full, Stack trace (when copying this message...):\n0. DB::Exception @ 0x17',
      }),
    ])

    expect(alerts[0]?.why).toBe('Disk full, ')
  })

  it('never puts the credentials into an alert, whatever ClickHouse echoed back', async () => {
    const { alerts } = await run([
      attempt({ status: 'BACKUP_FAILED', error: `rejected key ${KEY} secret ${SECRET}` }),
    ])

    expect(alerts[0]?.why).not.toContain(SECRET)
    expect(alerts[0]?.why).not.toContain(KEY)
    expect(alerts[0]?.why).toContain('[redacted]')
  })

  it('alerts and starts nothing when it cannot read the history', async () => {
    const { report, started, alerts } = await run(new Error('ClickHouse returned HTTP 503'))

    expect(report.state).toBe('unreadable')
    expect(started).toEqual([])
    expect(alerts).toEqual([{ kind: 'history-unreadable', why: 'ClickHouse returned HTTP 503' }])
  })

  it('alerts when the backup cannot even be started', async () => {
    const { report, alerts } = await run([], {
      start: async () => {
        throw new Error(`refused for ${SECRET}`)
      },
    })

    expect(report.state).toBe('unstarted')
    expect(alerts[0]?.kind).toBe('backup-unstarted')
    expect(alerts[0]?.why).not.toContain(SECRET)
  })
})

describe('what the task refuses to be built with', () => {
  const deps = {
    history: async () => [],
    start: async () => undefined,
  }

  it('refuses a destination that is not an http address, at startup and not at 03:00', () => {
    expect(() =>
      clickHouseBackupTask({
        database: 'nekolog_dev',
        destination: { ...destination, endpoint: 'file:///var/backups' },
        ...deps,
      }),
    ).toThrow(/plain http or https/)
  })

  it('refuses an empty credential, which would write a public object', () => {
    expect(() =>
      clickHouseBackupTask({
        database: 'nekolog_dev',
        destination: { ...destination, secretAccessKey: '' },
        ...deps,
      }),
    ).toThrow(/without credentials/)
  })

  it('refuses a database name it would have to interpolate blindly', () => {
    expect(() => clickHouseBackupTask({ database: 'nekolog; DROP', destination, ...deps })).toThrow(
      /unsafe database name/,
    )
  })
})

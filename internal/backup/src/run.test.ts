import { describe, expect, it } from 'vitest'
import type { Command } from './commands.ts'
import type { PipelineResult } from './pipe.ts'
import { BACKUP_PREFIX, keyFor } from './plan.ts'
import { type BackupAlert, keysFromListing, periodStart, runBackup, scrub } from './run.ts'

const SECRET = 'b0e7a4c21d8f5639ae0c47b2f81d3a6950c8e2b47f1a9d3c6e05b8a2f47c91d3'
const KEY_ID = 'GK31c2f218a2e44f485b94239e'
const DATABASE_URL = 'postgres://nekolog:hunter2@postgres:5432/nekolog'

const destination = {
  bucketUrl: 'https://account.r2.cloudflarestorage.com/nekolog-backups',
  accessKeyId: KEY_ID,
  secretAccessKey: SECRET,
}

const NOW = Date.parse('2026-11-05T04:00:00.000Z')

type Run = {
  report: Awaited<ReturnType<typeof runBackup>>
  ran: Command[][]
  alerts: BackupAlert[]
}

function listingOf(keys: readonly string[], environment = 'prod'): string {
  return keys.map((key) => key.replace(`${BACKUP_PREFIX}${environment}/`, '')).join('\n')
}

async function run(
  listing: string | Error,
  options: { failUpload?: boolean; failDelete?: boolean; keepDays?: number } = {},
): Promise<Run> {
  const ran: Command[][] = []
  const alerts: BackupAlert[] = []

  const report = await runBackup({
    environment: 'prod',
    databaseUrl: DATABASE_URL,
    recipient: 'age1examplerecipient',
    destination,
    now: () => NOW,
    ...(options.keepDays === undefined ? {} : { keepDays: options.keepDays }),
    onAlert: (alert) => alerts.push(alert),
    run: async (steps): Promise<PipelineResult> => {
      ran.push([...steps])
      const first = steps[0] as Command

      if (first.args[0] === 'lsf') {
        if (listing instanceof Error) {
          throw listing
        }
        return { stdout: listing, stderr: '' }
      }
      if (first.file === 'pg_dump' && options.failUpload === true) {
        throw new Error(`"rclone" exited 1: cannot reach ${destination.bucketUrl} with ${SECRET}`)
      }
      if (first.args[0] === 'deletefile' && options.failDelete === true) {
        throw new Error('"rclone" exited 1: forbidden')
      }
      return { stdout: '', stderr: '' }
    },
  })

  return { report, ran, alerts }
}

describe('what the runner asks the bucket before it does anything', () => {
  it('turns a listing into whole keys, because rclone prints names relative to the folder', () => {
    expect(keysFromListing('2026-11-05T03-00-00Z.sql.gz.age\n\n', 'prod')).toEqual([
      'postgres/prod/2026-11-05T03-00-00Z.sql.gz.age',
    ])
  })

  it('cuts the period at UTC midnight, the same as the ClickHouse one', () => {
    expect(periodStart(NOW)).toBe(Date.parse('2026-11-05T00:00:00.000Z'))
    expect(() => periodStart(NOW, 1000)).toThrow(/not a period/)
  })
})

describe('the postgres backup run', () => {
  it('dumps when the day has none, and names the file after now', async () => {
    const { report, ran } = await run('')

    expect(report.state).toBe('written')
    expect(report.key).toBe('postgres/prod/2026-11-05T04-00-00Z.sql.gz.age')
    expect(ran[1]?.map((step) => step.file)).toEqual(['pg_dump', 'gzip', 'age', 'rclone'])
    expect(ran[1]?.[3]?.args).toEqual([
      'rcat',
      'backup:nekolog-backups/postgres/prod/2026-11-05T04-00-00Z.sql.gz.age',
    ])
  })

  it('does nothing when the day already has one', async () => {
    const { report, ran } = await run(
      listingOf([keyFor('prod', new Date(Date.parse('2026-11-05T03:00:00.000Z')))]),
    )

    expect(report.state).toBe('done')
    expect(ran).toHaveLength(1)
  })

  it('does not count yesterday as today', async () => {
    const { report } = await run(
      listingOf([keyFor('prod', new Date(Date.parse('2026-11-04T03:00:00.000Z')))]),
    )

    expect(report.state).toBe('written')
  })

  it('alerts and does nothing at all when it cannot read the bucket', async () => {
    const { report, ran, alerts } = await run(new Error('rclone: AccessDenied'))

    expect(report.state).toBe('unreadable')
    expect(ran).toHaveLength(1)
    expect(alerts).toEqual([{ kind: 'listing-unreadable', why: 'rclone: AccessDenied' }])
  })

  it('never deletes anything on a day it failed to write one', async () => {
    const old = keyFor('prod', new Date(Date.parse('2025-01-01T03:00:00.000Z')))
    const { report, ran, alerts } = await run(listingOf([old]), { failUpload: true })

    expect(report.state).toBe('failed')
    expect(report.deleted).toBe(0)
    expect(ran.some((steps) => steps[0]?.args[0] === 'deletefile')).toBe(false)
    expect(alerts[0]?.kind).toBe('dump-failed')
  })

  it('never puts a credential into an alert, whatever the tool echoed back', async () => {
    const { alerts } = await run('', { failUpload: true })

    expect(alerts[0]?.why).not.toContain(SECRET)
    expect(alerts[0]?.why).toContain('[redacted]')
  })

  it('deletes what is past the retention once the new one is safely written', async () => {
    const old = keyFor('prod', new Date(Date.parse('2025-01-01T03:00:00.000Z')))
    const { report, ran } = await run(listingOf([old]), { keepDays: 30 })

    expect(report.state).toBe('written')
    expect(report.deleted).toBe(1)
    expect(ran.at(-1)?.[0]?.args).toEqual(['deletefile', `backup:nekolog-backups/${old}`])
  })

  it('keeps the backup it just wrote even when every stored one has expired', async () => {
    const old = keyFor('prod', new Date(Date.parse('2025-01-01T03:00:00.000Z')))
    const { report } = await run(listingOf([old, old.replace('T03', 'T04')]), { keepDays: 30 })

    expect(report.state).toBe('written')
    expect(report.deleted).toBe(2)
  })

  it('warns but still reports the backup when the pruning fails', async () => {
    const old = keyFor('prod', new Date(Date.parse('2025-01-01T03:00:00.000Z')))
    const { report, alerts } = await run(listingOf([old]), { failDelete: true, keepDays: 30 })

    expect(report.state).toBe('written')
    expect(alerts.map((alert) => alert.kind)).toEqual(['prune-failed'])
  })
})

describe('scrubbing a reason before it leaves the machine', () => {
  it('removes every secret it was given, and flattens the whitespace', () => {
    const text = `failed with ${SECRET}\n  and ${KEY_ID}\n  and ${DATABASE_URL}`

    expect(scrub(new Error(text), [SECRET, KEY_ID, DATABASE_URL])).toBe(
      'failed with [redacted] and [redacted] and [redacted]',
    )
  })

  it('ignores an empty secret instead of redacting every character', () => {
    expect(scrub('nothing to hide', ['', '  '])).toBe('nothing to hide')
  })
})

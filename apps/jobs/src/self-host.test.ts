import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type LocalIngestConfig,
  localIngestApp,
  selfHostIngestConfigFrom,
  selfHostIngestWiring,
} from '@apps/ingest'
import { buildSeed, serialiseSeedDocument, toDocument } from '@internal/seed'
import type { SqlRunner } from '@nekolog-io/adapters'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_VARIABLES,
  backupWiringFrom,
  DEFAULT_JOBS_PORT,
  NO_BACKUP_WARNING,
  portFrom,
  type SelfHostJobsEnv,
  selfHostJobsConfigFrom,
  selfHostJobTasks,
  selfHostTaskDeps,
} from './self-host.ts'
import { spoolResendTask } from './tasks/spool-resend.ts'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'nekolog-jobs-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

function envFor(): SelfHostJobsEnv {
  return {
    CLICKHOUSE_URL: 'http://127.0.0.1:1',
    CLICKHOUSE_DB: 'nekolog',
    CLICKHOUSE_JOBS_USER: 'nekolog_jobs',
    CLICKHOUSE_JOBS_PASSWORD: 'nekolog',
    DATABASE_URL: 'postgres://nekolog:nekolog@127.0.0.1:5432/nekolog',
    NEKOLOG_CONSOLE_URL: 'https://logs.example.com',
    ENCRYPTION_KEY: 'a'.repeat(64),
    SPOOL_DIR: join(folder, 'spool'),
    KV_DIR: join(folder, 'kv'),
  }
}

const backupEnv = {
  CLICKHOUSE_BACKUP_PASSWORD: 'another-one',
  BACKUP_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com/nekolog-backups',
  BACKUP_S3_ACCESS_KEY_ID: 'GK31c2f218a2e44f485b94239e',
  BACKUP_S3_SECRET_ACCESS_KEY: 'b'.repeat(64),
} satisfies Partial<SelfHostJobsEnv>

const NOTHING: SqlRunner = async () => []

function names(tasks: ReadonlyArray<{ name: string }>): string[] {
  return tasks.map((task) => task.name).sort()
}

describe('the configuration the self-host jobs container reads', () => {
  it('names every missing value at once, instead of one per restart', () => {
    expect(() => selfHostJobsConfigFrom({})).toThrow(
      /CLICKHOUSE_URL, CLICKHOUSE_DB, CLICKHOUSE_JOBS_USER, CLICKHOUSE_JOBS_PASSWORD, DATABASE_URL, NEKOLOG_CONSOLE_URL, ENCRYPTION_KEY, SPOOL_DIR, KV_DIR/,
    )
  })

  it.each([
    'DATABASE_URL',
    'NEKOLOG_CONSOLE_URL',
    'ENCRYPTION_KEY',
    'SPOOL_DIR',
    'KV_DIR',
  ] as const)('refuses to start without %s, because the alerts would silently not run', (name) => {
    expect(() => selfHostJobsConfigFrom({ ...envFor(), [name]: undefined })).toThrow(name)
    expect(() => selfHostJobsConfigFrom({ ...envFor(), [name]: '' })).toThrow(name)
  })

  it('listens on every interface and has a port of its own', () => {
    const config = selfHostJobsConfigFrom(envFor())

    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(DEFAULT_JOBS_PORT)
    expect(portFrom('9000')).toBe(9000)
    expect(() => portFrom('65536')).toThrow('JOBS_PORT')
  })

  it('leaves the optional signals out when nobody configured them', () => {
    const config = selfHostJobsConfigFrom(envFor())

    expect(config.heartbeatUrl).toBeUndefined()
    expect(config.opsWebhookUrl).toBeUndefined()
    expect(config.dailyQuota).toBeUndefined()
  })
})

describe('what the self-host jobs container actually runs', () => {
  it('registers every task, the Postgres ones included', () => {
    const here = names(selfHostJobTasks({ config: selfHostJobsConfigFrom(envFor()), sql: NOTHING }))

    expect(here).toEqual([
      'alert-evaluate',
      'alert-notify',
      'capacity-watch',
      'issue-rollup',
      'quota-block',
      'spool-resend',
    ])
  })

  it('tells the operator when the capacity task cannot read a disk', async () => {
    const sent: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      if (url.includes('discord.com')) {
        sent.push(init.body)
        return { ok: true, status: 204, text: async () => '' }
      }
      throw new Error('ClickHouse is unreachable')
    }) as never

    try {
      const config = selfHostJobsConfigFrom({
        ...envFor(),
        OPS_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
      })
      const capacity = selfHostJobTasks({ config, sql: NOTHING }).find(
        (task) => task.name === 'capacity-watch',
      )

      await capacity?.run({
        scheduledAt: Date.now(),
        signal: new AbortController().signal,
      } as never)
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      globalThis.fetch = original
    }

    expect(sent.length).toBeGreaterThan(0)
    expect(JSON.parse(sent[0] ?? '{}').content).toContain('CRITICAL')
  })

  it('hands the delivery the key that opens a channel secret, and the console link', () => {
    const config = selfHostJobsConfigFrom({
      ...envFor(),
      NEKOLOG_CONSOLE_URL: 'https://logs.example.com',
    })
    const deps = selfHostTaskDeps({ config, sql: NOTHING })

    expect(deps.alertDelivery?.secretKey).toBe('a'.repeat(64))
    expect(deps.alertDelivery?.dashboardUrl).toBe('https://logs.example.com')
    expect(deps.alertTarget?.database).toBe('nekolog')
  })

  it('does not back ClickHouse up until somebody says where to, and says so out loud', () => {
    const config = selfHostJobsConfigFrom(envFor())
    const here = names(selfHostJobTasks({ config, sql: NOTHING }))

    expect(config.backup).toBeUndefined()
    expect(here).not.toContain('clickhouse-backup')
    expect(NO_BACKUP_WARNING).toContain('exactly one place')
    for (const name of BACKUP_VARIABLES) {
      expect(NO_BACKUP_WARNING).toContain(name)
    }
  })

  it('backs it up once the destination and the credential are there', () => {
    const config = selfHostJobsConfigFrom({ ...envFor(), ...backupEnv })
    const here = names(selfHostJobTasks({ config, sql: NOTHING }))

    expect(here).toContain('clickhouse-backup')
    expect(config.backup?.clickHouse.user).toBe('nekolog_backup')
    expect(config.backup?.clickHouse.database).toBe('nekolog')
  })

  it('runs the backup as a credential of its own, never as the jobs one', () => {
    const config = selfHostJobsConfigFrom({ ...envFor(), ...backupEnv })

    expect(config.backup?.clickHouse.user).not.toBe(config.clickHouse.user)
    expect(config.backup?.clickHouse.password).not.toBe(config.clickHouse.password)
  })

  it.each([...BACKUP_VARIABLES, 'CLICKHOUSE_BACKUP_PASSWORD' as const])(
    'refuses to start with %s missing from the rest',
    (name) => {
      expect(() => backupWiringFrom({ ...envFor(), ...backupEnv, [name]: undefined })).toThrow(
        new RegExp(`half configured: .*${name}`),
      )
    },
  )

  it('takes the credential name as given, and names it itself when nobody did', () => {
    const chosen = backupWiringFrom({
      ...envFor(),
      ...backupEnv,
      CLICKHOUSE_BACKUP_USER: 'someone_else',
    })

    expect(chosen?.clickHouse.user).toBe('someone_else')
    expect(backupWiringFrom({ ...envFor(), ...backupEnv })?.clickHouse.user).toBe('nekolog_backup')
  })

  it('exports nothing yet, and does not pretend otherwise', () => {
    const here = names(selfHostJobTasks({ config: selfHostJobsConfigFrom(envFor()), sql: NOTHING }))

    expect(here).not.toContain('export-run')
    expect(here).not.toContain('export-schedule')
    expect(here).not.toContain('export-notify')
  })
})

describe('the handoff between the two containers, over one directory', () => {
  it('resends the batch the ingest container parked when ClickHouse refused it', async () => {
    const ingestConfig = selfHostIngestConfigFrom({
      CLICKHOUSE_URL: 'http://127.0.0.1:1',
      CLICKHOUSE_DB: 'nekolog',
      CLICKHOUSE_INSERT_USER: 'nekolog_ingest',
      CLICKHOUSE_INSERT_PASSWORD: 'nekolog',
      SPOOL_DIR: join(folder, 'spool'),
      KV_DIR: join(folder, 'kv'),
    }) satisfies LocalIngestConfig

    const seed = await buildSeed({ organization: 'n', project: 'p' })
    const environment = seed.environments[0]
    const key = environment?.keys.find((entry) => entry.kind === 'secret')?.value as string

    const document = toDocument(seed)
    const seedFile = join(folder, '.nekolog-seed.json')
    writeFileSync(seedFile, serialiseSeedDocument(document), 'utf8')

    const app = await localIngestApp(
      selfHostIngestWiring({ config: ingestConfig, document, seedFile }),
    )
    const parked = await app.request('http://127.0.0.1/v1/logs', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        sdk: { name: 'node', version: '1.0.0' },
        resource: { service: 'checkout', runtime: 'node' },
        events: [{ timestamp: new Date().toISOString(), level: 'error', message: 'it broke' }],
      }),
    })
    expect(parked.status).toBe(202)

    const jobsConfig = selfHostJobsConfigFrom(envFor())
    const { fileBlobStore } = await import('@internal/self-host')
    const spool = fileBlobStore(jobsConfig.spoolDir)
    expect(await spool.list('spool/')).toHaveLength(1)

    const written: unknown[][] = []
    const task = spoolResendTask({
      spool,
      logStore: {
        async insert(rows) {
          written.push([...rows])
          return { accepted: rows.length }
        },
      },
    })

    await task.run({
      scheduledAt: Date.now(),
      cron: '* * * * *',
      signal: AbortSignal.timeout(5000),
    })

    expect(written).toHaveLength(1)
    expect(written[0]).toHaveLength(1)
    expect(await spool.list('spool/')).toEqual([])
  })
})

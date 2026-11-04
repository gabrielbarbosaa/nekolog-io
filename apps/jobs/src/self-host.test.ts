import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type LocalIngestConfig,
  localIngestApp,
  selfHostIngestConfigFrom,
  selfHostIngestWiring,
} from '@apps/ingest'
import { buildSeed, toDocument } from '@internal/seed'
import type { SqlRunner } from '@nekolog-io/adapters'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_JOBS_PORT,
  portFrom,
  type SelfHostJobsEnv,
  selfHostJobsConfigFrom,
  selfHostJobTasks,
  selfHostTaskDeps,
} from './self-host.ts'
import { spoolResendTask } from './tasks/spool-resend.ts'
import { buildJobTasks, type JobsEnv } from './worker.ts'

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
  it('runs the Postgres tasks the Cloudflare worker cannot, and all of the worker’s', () => {
    const workerEnv: JobsEnv = {
      KEYS: {
        async get() {
          return null
        },
        async put() {},
        async delete() {},
      },
      SPOOL: {
        async put() {
          return undefined
        },
        async get() {
          return null
        },
        async delete() {},
        async list() {
          return { objects: [], truncated: false }
        },
      },
      CLICKHOUSE_URL: 'http://127.0.0.1:1',
      CLICKHOUSE_DB: 'nekolog',
      CLICKHOUSE_JOBS_USER: 'nekolog_jobs',
      CLICKHOUSE_JOBS_PASSWORD: 'nekolog',
    }

    const onCloudflare = names(buildJobTasks(workerEnv))
    const here = names(selfHostJobTasks({ config: selfHostJobsConfigFrom(envFor()), sql: NOTHING }))

    expect(onCloudflare).toEqual(['capacity-watch', 'quota-block', 'spool-resend'])
    expect(here).toEqual([
      'alert-evaluate',
      'alert-notify',
      'capacity-watch',
      'issue-rollup',
      'quota-block',
      'spool-resend',
    ])
    for (const task of onCloudflare) {
      expect(here).toContain(task)
    }
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

    const app = await localIngestApp(
      selfHostIngestWiring({ config: ingestConfig, document: toDocument(seed) }),
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

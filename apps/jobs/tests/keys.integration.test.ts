import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIngestApp, createKeyAuthenticator, createLogStoreSink } from '@apps/ingest'
import { fileKvNamespace } from '@internal/self-host'
import {
  cachedKeyStore,
  generateApiKey,
  hashApiKey,
  kvKeyStore,
  type SqlRunner,
  sqlKeyDirectory,
} from '@nekolog-io/adapters'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@nekolog-io/clickhouse'
import { clickHouseLogStore } from '@nekolog-io/clickhouse/log-store'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type KeySyncReport, keySyncTask } from '../src/tasks/key-sync.ts'
import { type KeyUsageReport, keyUsageTask } from '../src/tasks/key-usage.ts'
import { keyUsageReaderFor } from '../src/wiring.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const POSTGRES =
  process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'

const database = `nekolog_keys_${process.pid}`
const config: ClickHouseConfig = { ...base, database }

async function postgresAnswers(): Promise<boolean> {
  const probe = postgres(POSTGRES, { max: 1, connect_timeout: 2, onnotice: () => {} })
  try {
    await probe.unsafe('select 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end({ timeout: 1 })
  }
}

const reachable = (await ping(config)) && (await postgresAnswers())

if (!reachable) {
  if (process.env.CLICKHOUSE_TEST_REQUIRED === '1' || process.env.POSTGRES_TEST_REQUIRED === '1') {
    throw new Error(
      `A key test needs both ${base.url} and ${POSTGRES}, and one of them did not answer. ` +
        'These tests must not be skipped here.',
    )
  }
  process.stderr.write(
    '\nSkipping the key tests: ClickHouse or Postgres did not answer.\n' +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
)

const PG_DATABASE = `nekolog_keysync_${process.pid}`

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function newId(prefix: string): string {
  return prefix + Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('')
}

const ORGANIZATION = newId('org_')
const PROJECT = newId('prj_')
const ENVIRONMENT = newId('env_')
const KEY = newId('key_')
const SECOND_KEY = newId('key_')

const FIRST = generateApiKey('secret')
const SECOND = generateApiKey('secret')

let sql: ReturnType<typeof postgres>
let run: SqlRunner
let folder: string
let batches = 0

function ingestReading(kvFolder: string) {
  return createIngestApp({
    authenticate: createKeyAuthenticator({
      keyStore: cachedKeyStore(kvKeyStore(fileKvNamespace(kvFolder)), { ttlMs: 0 }),
    }),
    sink: createLogStoreSink({ logStore: clickHouseLogStore(config) }),
    onError: (error) => {
      throw error
    },
  })
}

async function send(key: string, message: string): Promise<Response> {
  batches += 1
  const suffix = batches.toString(16).padStart(2, '0')
  return ingestReading(folder).request(
    new Request('https://ingest.nekolog.io/v1/logs', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: `01933b9e-7c1a-7d4f-9a51-3f0f6c2e8c${suffix}`,
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'checkout-api', runtime: 'node' },
        events: [{ timestamp: new Date().toISOString(), level: 'info', message }],
      }),
    }),
  )
}

async function syncKeys(): Promise<KeySyncReport> {
  return (await keySyncTask({
    directory: sqlKeyDirectory(run),
    kv: fileKvNamespace(folder),
  }).run({
    scheduledAt: Date.now(),
    cron: '* * * * *',
    signal: new AbortController().signal,
  })) as KeySyncReport
}

async function stampUsage(): Promise<KeyUsageReport> {
  return (await keyUsageTask({
    directory: sqlKeyDirectory(run),
    read: keyUsageReaderFor(config),
  }).run({
    scheduledAt: Date.now(),
    cron: '* * * * *',
    signal: new AbortController().signal,
  })) as KeyUsageReport
}

async function lastUsed(keyId: string): Promise<string | null> {
  const rows = (await sql.unsafe('select last_used_at from api_keys where id = $1', [
    keyId,
  ])) as unknown as Array<{ last_used_at: Date | null }>
  return rows[0]?.last_used_at?.toISOString() ?? null
}

describe.skipIf(!reachable)('a key minted in the database, used at the ingestion', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)

    const admin = postgres(POSTGRES, { max: 1, onnotice: () => {} })
    try {
      await admin.unsafe(`create database "${PG_DATABASE}"`)
    } finally {
      await admin.end()
    }

    sql = postgres(POSTGRES.replace(/\/[^/]*$/, `/${PG_DATABASE}`), { max: 2, onnotice: () => {} })
    for (const statement of migrationStatements()) {
      await sql.unsafe(statement)
    }
    run = async (text, params) =>
      (await sql.unsafe(text, params as never[])) as unknown as ReadonlyArray<
        Record<string, unknown>
      >

    await sql.unsafe('insert into organizations (id, name) values ($1, $2)', [ORGANIZATION, 'Acme'])
    await sql.unsafe('insert into projects (id, organization_id, name) values ($1, $2, $3)', [
      PROJECT,
      ORGANIZATION,
      'The Shop',
    ])
    await sql.unsafe(
      `insert into environments (id, project_id, name, retention_days, min_level, sample_rate)
       values ($1, $2, 'production', 14, 'info', 1)`,
      [ENVIRONMENT, PROJECT],
    )
    for (const [id, value] of [
      [KEY, FIRST],
      [SECOND_KEY, SECOND],
    ] as const) {
      await sql.unsafe(
        `insert into api_keys (id, environment_id, kind, hash, hint, scopes)
         values ($1, $2, 'secret', $3, $4, array['logs:write'])`,
        [id, ENVIRONMENT, await hashApiKey(value), `nekolog_sk_…${value.slice(-4)}`],
      )
    }

    folder = await mkdtemp(join(tmpdir(), 'nekolog-keys-'))
  }, 120_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
    await sql?.end()
    const admin = postgres(POSTGRES, { max: 1, onnotice: () => {} })
    try {
      await admin.unsafe(`drop database if exists "${PG_DATABASE}" with (force)`)
    } finally {
      await admin.end()
    }
    if (folder !== undefined) {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('is refused until the sync has run, and accepted straight after', async () => {
    expect((await send(FIRST, 'too early')).status, 'nothing has been published yet').toBe(401)

    const report = await syncKeys()
    expect(report.written).toBe(2)

    expect((await send(FIRST, 'after the sync')).status).toBe(202)
  })

  it('writes the key that sent it into the row, which is what a rotation asks about', async () => {
    await send(SECOND, 'from the second key')

    const rows = await queryRows<{ key_id: string; message: string }>(
      config,
      `select key_id, message from ${database}.logs order by received_at`,
    )

    expect(rows.find((row) => row.message === 'after the sync')?.key_id).toBe(KEY)
    expect(rows.find((row) => row.message === 'from the second key')?.key_id).toBe(SECOND_KEY)
  })

  it('carries the environment settings, so the minimum level is enforced at the ingestion', async () => {
    const quiet = await ingestReading(folder).request(
      new Request('https://ingest.nekolog.io/v1/logs', {
        method: 'POST',
        headers: { authorization: `Bearer ${FIRST}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8dff',
          sdk: { name: '@nekolog-io/node', version: '0.0.0' },
          resource: { service: 'checkout-api', runtime: 'node' },
          events: [
            { timestamp: new Date().toISOString(), level: 'debug', message: 'below the floor' },
          ],
        }),
      }),
    )

    expect(quiet.status).toBe(202)

    const rows = await queryRows<{ n: string }>(
      config,
      `select count() as n from ${database}.logs where message = 'below the floor'`,
      { settings: { output_format_json_quote_64bit_integers: '0' } },
    )
    expect(Number(rows[0]?.n ?? -1), 'min_level comes from the environment through the KV').toBe(0)
  })

  it('fills in the last use from the rows, and only for the keys that wrote one', async () => {
    expect(await lastUsed(KEY)).toBeNull()

    const report = await stampUsage()

    expect(report.seen).toBe(2)
    expect(report.stamped).toBe(2)
    expect(await lastUsed(KEY)).not.toBeNull()
    expect(await lastUsed(SECOND_KEY)).not.toBeNull()
  })

  it('stops accepting a revoked key once the next sync has run', async () => {
    await sql.unsafe('update api_keys set revoked_at = now() where id = $1', [SECOND_KEY])

    expect(
      (await send(SECOND, 'still inside the window')).status,
      'the KV has not been told yet, which is the ~60 s the plan promises',
    ).toBe(202)

    const report = await syncKeys()
    expect(report.removed).toBe(1)

    expect((await send(SECOND, 'after the revocation')).status).toBe(401)
    expect((await send(FIRST, 'the other key still works')).status).toBe(202)
  })

  it('takes the keys of a deleted project out of the KV, where no row is left to read', async () => {
    await sql.unsafe('delete from projects where id = $1', [PROJECT])

    const report = await syncKeys()

    expect(report.live).toBe(0)
    expect(report.removed).toBe(1)
    expect((await send(FIRST, 'after the project went')).status).toBe(401)
  })
})

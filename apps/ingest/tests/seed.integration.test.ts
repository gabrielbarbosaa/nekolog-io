import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@internal/clickhouse'
import { clickHouseLogStore } from '@internal/clickhouse/log-store'
import {
  buildSeed,
  keyStoreFromDocument,
  type Seed,
  type SeedDocument,
  toDocument,
} from '@internal/seed'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIngestApp } from '../src/app.ts'
import { createKeyAuthenticator } from '../src/authenticate.ts'
import { createLogStoreSink } from '../src/sink.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_seed_${process.pid}`
const config: ClickHouseConfig = { ...base, database }
const reachable = await ping(config)

if (!reachable) {
  if (process.env.CLICKHOUSE_TEST_REQUIRED === '1') {
    throw new Error(
      `CLICKHOUSE_TEST_REQUIRED is set but nothing answered at ${base.url}. ` +
        'These tests must not be skipped here.',
    )
  }
  process.stderr.write(
    `\nSkipping the seed tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

let seed: Seed
let document: SeedDocument
let app: ReturnType<typeof createIngestApp>

let batches = 0

function keyFor(environment: string, kind: 'public' | 'secret'): string {
  const found = seed.environments
    .find((entry) => entry.name === environment)
    ?.keys.find((key) => key.kind === kind)
  if (found === undefined) {
    throw new Error(`the seed has no ${kind} key for ${environment}`)
  }
  return found.value
}

function send(key: string, message: string, headers: Record<string, string> = {}) {
  batches += 1
  const suffix = batches.toString(16).padStart(2, '0')
  const inHeader = key.startsWith('nekolog_sk_')
  return app.request(
    new Request(
      inHeader
        ? 'https://ingest.nekolog.io/v1/logs'
        : `https://ingest.nekolog.io/v1/logs?key=${key}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(inHeader ? { authorization: `Bearer ${key}` } : {}),
          ...headers,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          batchId: `01933b9e-7c1a-7d4f-9a51-3f0f6c2e8c${suffix}`,
          sdk: { name: '@nekolog-io/node', version: '0.0.0' },
          resource: { service: 'checkout-api', runtime: 'node' },
          events: [{ timestamp: new Date().toISOString(), level: 'info', message }],
        }),
      },
    ),
  )
}

async function rowFor(message: string): Promise<Record<string, unknown> | undefined> {
  const rows = await queryRows<Record<string, unknown>>(
    config,
    `SELECT project_id, environment_id, retention_days FROM ${database}.logs
     WHERE message = {message:String}`,
    { params: { message } },
  )
  return rows[0]
}

function environmentId(name: string): string {
  const found = document.environments.find((entry) => entry.name === name)
  if (found === undefined) {
    throw new Error(`the seed has no environment called ${name}`)
  }
  return found.id
}

describe.skipIf(!reachable)('a key the seed script minted', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)

    seed = await buildSeed({
      organization: 'ATF',
      project: 'checkout',
      retentionDays: 3,
      originAllowlist: ['https://app.test'],
    })
    document = toDocument(seed)

    app = createIngestApp({
      authenticate: createKeyAuthenticator({ keyStore: await keyStoreFromDocument(document) }),
      sink: createLogStoreSink({ logStore: clickHouseLogStore(config) }),
      onError: (error) => {
        throw error
      },
    })
  }, 60_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('writes a log all the way into ClickHouse', async () => {
    expect((await send(keyFor('production', 'secret'), 'seeded')).status).toBe(202)

    expect(await rowFor('seeded')).toMatchObject({
      project_id: document.project.id,
      environment_id: environmentId('production'),
    })
  })

  it('decides the environment from the key, not from the sender', async () => {
    await send(keyFor('staging', 'secret'), 'from staging')

    expect((await rowFor('from staging'))?.environment_id).toBe(environmentId('staging'))
  })

  it('carries the retention the seed gave that environment', async () => {
    expect((await rowFor('seeded'))?.retention_days).toBe(3)
  })

  it('accepts the public key from an origin the seed allowed', async () => {
    const response = await send(keyFor('development', 'public'), 'from the browser', {
      origin: 'https://app.test',
    })

    expect(response.status).toBe(202)
    expect((await rowFor('from the browser'))?.environment_id).toBe(environmentId('development'))
  })

  it('refuses that same public key from anywhere else', async () => {
    const response = await send(keyFor('development', 'public'), 'from elsewhere', {
      origin: 'https://evil.test',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'origin_not_allowed' } })
    expect(await rowFor('from elsewhere')).toBeUndefined()
  })

  it('does not know a key from a different seed', async () => {
    const other = await buildSeed({ organization: 'other', project: 'other' })
    const key = other.environments[0]?.keys[1]?.value ?? ''

    const response = await send(key, 'from another seed')

    expect(response.status).toBe(401)
    expect(await rowFor('from another seed')).toBeUndefined()
  })
})

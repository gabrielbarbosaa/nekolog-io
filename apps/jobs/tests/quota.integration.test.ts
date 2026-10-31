import { createIngestApp, createKeyAuthenticator, createLogStoreSink } from '@apps/ingest'
import {
  cachedBlockedEnvironments,
  generateApiKey,
  hashApiKey,
  type KeyRecord,
  memoryKeyStore,
  memoryQuotaStore,
} from '@internal/adapters'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@internal/clickhouse'
import { clickHouseLogStore } from '@internal/clickhouse/log-store'
import { clickHouseUsageStore } from '@internal/clickhouse/usage-store'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quotaBlockTask, startOfUtcDay } from '../src/tasks/quota-block.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_quota_${process.pid}`
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
    `\nSkipping the quota tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const BUSY_KEY = generateApiKey('secret')
const BACKDATING_KEY = generateApiKey('secret')
const QUIET_KEY = generateApiKey('secret')

function record(environmentId: string): KeyRecord {
  return {
    projectId: 'p_demo',
    environmentId,
    scopes: ['logs:write'],
    originAllowlist: null,
    blocked: false,
    retentionDays: 7,
  }
}

const keyStore = memoryKeyStore()
const quotas = memoryQuotaStore()

const ingest = createIngestApp({
  authenticate: createKeyAuthenticator({
    keyStore,
    blocks: cachedBlockedEnvironments(quotas, { ttlMs: 0 }),
  }),
  sink: createLogStoreSink({ logStore: clickHouseLogStore(config) }),
  onError: (error) => {
    throw error
  },
})

let batches = 0

async function send(key: string, count: number, timestamp: string): Promise<Response> {
  batches += 1
  const suffix = batches.toString(16).padStart(2, '0')
  return await ingest.request(
    new Request('https://ingest.nekolog.io/v1/logs', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: `01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b${suffix}`,
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'checkout-api', runtime: 'node' },
        events: Array.from({ length: count }, (_, index) => ({
          timestamp,
          level: 'info',
          message: `event ${batches}-${index}`,
        })),
      }),
    }),
  )
}

const NOW = () => Date.now()

async function usageToday(environmentId: string): Promise<number> {
  const usage = await clickHouseUsageStore(config).eventsSince(startOfUtcDay(NOW()))
  return usage.find((row) => row.environmentId === environmentId)?.events ?? 0
}

async function chartedToday(environmentId: string): Promise<number> {
  const rows = await queryRows<{ total: unknown }>(
    config,
    `SELECT sum(events) AS total FROM ${database}.logs_per_minute
     WHERE environment_id = {environmentId:String} AND minute >= toDateTime({start:Int64})`,
    {
      params: { environmentId, start: String(Math.floor(startOfUtcDay(NOW()) / 1000)) },
      settings: { output_format_json_quote_64bit_integers: '0' },
    },
  )
  return Number(rows[0]?.total ?? 0)
}

function sweep(dailyQuota: number) {
  return quotaBlockTask({ usage: clickHouseUsageStore(config), quotas, dailyQuota }).run({
    scheduledAt: NOW(),
    cron: '* * * * *',
    signal: new AbortController().signal,
  })
}

describe.skipIf(!reachable)('the daily quota, end to end', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
    await keyStore.set(await hashApiKey(BUSY_KEY), record('e_busy'))
    await keyStore.set(await hashApiKey(BACKDATING_KEY), record('e_backdating'))
    await keyStore.set(await hashApiKey(QUIET_KEY), record('e_quiet'))
  }, 60_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('counts an event by when it arrived, not by the timestamp its sender chose', async () => {
    expect((await send(BACKDATING_KEY, 5, '2020-01-01T00:00:00.000Z')).status).toBe(202)

    expect(await usageToday('e_backdating')).toBe(5)
    expect(await chartedToday('e_backdating')).toBe(0)

    await send(BACKDATING_KEY, 2, new Date().toISOString())

    expect(await usageToday('e_backdating')).toBe(7)
    expect(await chartedToday('e_backdating')).toBe(2)
  })

  it('leaves an environment alone while it is under its quota', async () => {
    await send(BUSY_KEY, 4, new Date().toISOString())

    const report = await sweep(10)

    expect(report).toMatchObject({ blocked: 0, written: false })
    expect(await quotas.blocked()).toEqual([])
  })

  it('blocks the environment once the day has gone over', async () => {
    await send(BUSY_KEY, 6, new Date().toISOString())
    expect(await usageToday('e_busy')).toBe(10)

    const report = await sweep(10)

    expect(report).toMatchObject({ blocked: 1, written: true })
    expect((await quotas.blocked()).map((block) => block.environmentId)).toEqual(['e_busy'])
  })

  it('makes the ingestion api refuse that environment with a stable code', async () => {
    const response = await send(BUSY_KEY, 1, new Date().toISOString())

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: { code: 'quota_exceeded' } })
    expect(response.headers.get('retry-after')).toBe('60')
  })

  it('writes nothing for the batch it refused', async () => {
    expect(await usageToday('e_busy')).toBe(10)
  })

  it('keeps every other environment ingesting', async () => {
    expect((await send(QUIET_KEY, 1, new Date().toISOString())).status).toBe(202)
  })

  it('lets the environment back in when the quota is raised', async () => {
    const report = await sweep(1_000)

    expect(report).toMatchObject({ unblocked: 1, written: true })
    expect(await quotas.blocked()).toEqual([])
    expect((await send(BUSY_KEY, 1, new Date().toISOString())).status).toBe(202)
  })
})

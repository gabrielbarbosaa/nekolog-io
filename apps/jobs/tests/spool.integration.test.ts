import { createIngestApp, createKeyAuthenticator, createLogStoreSink } from '@apps/ingest'
import {
  generateApiKey,
  hashApiKey,
  type KeyRecord,
  type LogStore,
  memoryBlobStore,
  memoryKeyStore,
} from '@internal/adapters'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@internal/clickhouse'
import { clickHouseLogStore } from '@internal/clickhouse/log-store'
import { SPOOL_PREFIX } from '@internal/spool'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spoolResendTask } from '../src/tasks/spool-resend.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_spool_${process.pid}`
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
    `\nSkipping the spool tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const KEY = generateApiKey('secret')
const RECORD: KeyRecord = {
  projectId: 'p_demo',
  environmentId: 'e_dev',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
  retentionDays: 7,
}

const keyStore = memoryKeyStore()
const spool = memoryBlobStore()

const clickHouseIsDown: LogStore = {
  insert() {
    throw new Error('Code: 210. DB::NetException: Connection refused')
  },
}

const ingest = createIngestApp({
  authenticate: createKeyAuthenticator({ keyStore }),
  sink: createLogStoreSink({ logStore: clickHouseIsDown, spool }),
  onError: (error) => {
    throw error
  },
})

function batch(batchId: string, message: string, event: Record<string, unknown> = {}): Request {
  return new Request('https://ingest.nekolog.io/v1/logs', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      batchId,
      sdk: { name: '@nekolog-io/node', version: '0.0.0' },
      resource: { service: 'checkout-api', release: '1.4.2', runtime: 'node' },
      events: [{ timestamp: '2026-10-31T15:30:00.000Z', level: 'error', message, ...event }],
    }),
  })
}

async function stored(message: string): Promise<number> {
  const rows = await queryRows<{ total: string }>(
    config,
    `SELECT toString(count()) AS total FROM ${database}.logs WHERE message = '${message}'`,
  )
  return Number(rows[0]?.total ?? '0')
}

function resend() {
  return spoolResendTask({ spool, logStore: clickHouseLogStore(config) }).run({
    scheduledAt: Date.now(),
    cron: '* * * * *',
    signal: new AbortController().signal,
  })
}

describe.skipIf(!reachable)('an outage that does not lose logs', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
    await keyStore.set(await hashApiKey(KEY), RECORD)
  }, 60_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('keeps the batch in the spool while ClickHouse refuses it', async () => {
    const response = await ingest.request(batch('01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10', 'outage'))

    expect(response.status).toBe(202)
    expect(await spool.list(SPOOL_PREFIX)).toHaveLength(1)
    expect(await stored('outage')).toBe(0)
  })

  it('writes it for real once ClickHouse is back, and empties the spool', async () => {
    const report = await resend()

    expect(report).toMatchObject({ resent: 1, rows: 1, quarantined: 0, stopped: 'finished' })
    expect(await stored('outage')).toBe(1)
    expect(await spool.list(SPOOL_PREFIX)).toEqual([])
  })

  it('writes the same batch once even when the spool file is resent', async () => {
    await ingest.request(batch('01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b11', 'resent twice'))
    const [key] = await spool.list(SPOOL_PREFIX)
    const kept = await spool.get(key ?? '')

    await resend()
    expect(await stored('resent twice')).toBe(1)

    await spool.put(key ?? '', kept ?? new Uint8Array())
    const second = await resend()

    expect(second).toMatchObject({ resent: 1 })
    expect(await stored('resent twice')).toBe(1)
  })

  it('loses no column on the way through the spool, maps and all', async () => {
    await ingest.request(
      batch('01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b12', 'full row', {
        attributes: { orderId: 123, retry: true, 'tag.name': 'checkout' },
        trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
        session: { id: 's_1', userId: 'u_42' },
        error: { type: 'TypeError', message: 'full row', stack: 'TypeError: full row\n  at x' },
      }),
    )

    await resend()

    const [row] = await queryRows<Record<string, unknown>>(
      config,
      `SELECT * FROM ${database}.logs WHERE message = 'full row'`,
    )

    expect(row).toMatchObject({
      project_id: 'p_demo',
      environment_id: 'e_dev',
      level: 'error',
      service: 'checkout-api',
      release: '1.4.2',
      source: 'node',
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      session_id: 's_1',
      user_id: 'u_42',
      error_type: 'TypeError',
      retention_days: 7,
    })
    expect(row?.attributes).toEqual({ orderId: '123', retry: 'true', 'tag.name': 'checkout' })
    expect(String(row?.stacktrace)).toContain('TypeError')
  })

  it('quarantines a file ClickHouse will never accept instead of blocking the queue', async () => {
    await ingest.request(batch('01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b13', 'poison'))
    const [key] = await spool.list(SPOOL_PREFIX)
    const envelope = JSON.parse(
      new TextDecoder().decode((await spool.get(key ?? '')) ?? new Uint8Array()),
    )
    envelope.rows[0].no_such_column = 'boom'
    await spool.put(key ?? '', JSON.stringify(envelope))

    const report = await resend()

    expect(report).toMatchObject({ resent: 0, quarantined: 1, stopped: 'finished' })
    expect(await stored('poison')).toBe(0)
    expect(await spool.list(SPOOL_PREFIX)).toEqual([])
    expect(await spool.list('quarantine/')).toHaveLength(1)
  })
})

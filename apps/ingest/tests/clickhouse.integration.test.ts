import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateApiKey, hashApiKey, type KeyRecord, memoryKeyStore } from '@internal/adapters'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@internal/clickhouse'
import { clickHouseLogStore } from '@internal/clickhouse/log-store'
import { createLogger } from '@nekolog-io/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIngestApp, createKeyAuthenticator, createLogStoreSink } from '../src/index.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_ingest_${process.pid}`
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
    `\nSkipping the ingest-to-ClickHouse tests: nothing answered at ${base.url}.\n` +
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
let endpoint = ''
let server: Server

const app = createIngestApp({
  authenticate: createKeyAuthenticator({ keyStore }),
  sink: createLogStoreSink({ logStore: clickHouseLogStore(config) }),
  onError: (error) => {
    throw error
  },
})

async function toRequest(incoming: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of incoming) {
    chunks.push(chunk as Buffer)
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') {
      headers.set(name, value)
    }
  }
  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD'
  return new Request(`http://127.0.0.1${incoming.url ?? '/'}`, {
    method: incoming.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : null,
  })
}

async function storedWhere(where: string): Promise<Array<Record<string, unknown>>> {
  return queryRows<Record<string, unknown>>(
    config,
    `SELECT * FROM ${database}.logs WHERE ${where} ORDER BY timestamp`,
  )
}

describe.skipIf(!reachable)('a log from the sdk reaching ClickHouse', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
    await keyStore.set(await hashApiKey(KEY), RECORD)

    server = createServer((incoming, outgoing) => {
      void (async () => {
        const response = await app.fetch(await toRequest(incoming))
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      })()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }, 60_000)

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('carries an info log from log.info() to a row', async () => {
    const log = createLogger({
      apiKey: KEY,
      service: 'checkout-api',
      release: '1.4.2',
      transport: { endpoint, flushIntervalMs: 0 },
    })

    log.info('Pedido criado', { orderId: 123 })
    await log.flush()

    const [row] = await storedWhere("message = 'Pedido criado'")

    expect(row).toMatchObject({
      project_id: 'p_demo',
      environment_id: 'e_dev',
      level: 'info',
      service: 'checkout-api',
      release: '1.4.2',
      source: 'node',
      retention_days: 7,
    })
    expect(row?.attributes).toEqual({ orderId: '123' })
  })

  it('carries an error with its trace, session and stack', async () => {
    const traceId = 'a'.repeat(32)
    const log = createLogger({
      apiKey: KEY,
      service: 'checkout-api',
      level: 'trace',
      transport: { endpoint, flushIntervalMs: 0 },
    })

    log
      .child({
        trace: { traceId, spanId: 'b'.repeat(16) },
        session: { id: 's_1', userId: 'u_42' },
      })
      .error(new TypeError('gateway timeout'))
    await log.flush()

    const [row] = await storedWhere(`trace_id = '${traceId}'`)

    expect(row).toMatchObject({
      level: 'error',
      message: 'gateway timeout',
      error_type: 'TypeError',
      span_id: 'b'.repeat(16),
      session_id: 's_1',
      user_id: 'u_42',
    })
    expect(String(row?.stacktrace)).toContain('TypeError')
  })

  it('never writes a password the sdk stripped on the way out', async () => {
    const log = createLogger({
      apiKey: KEY,
      service: 'checkout-api',
      transport: { endpoint, flushIntervalMs: 0 },
    })

    log.info('login with card 4111111111111111', { user: { password: 'hunter2' } })
    await log.flush()

    const [row] = await storedWhere("message LIKE 'login with card%'")

    expect(row?.message).toBe('login with card [redacted]')
    expect(row?.attributes).toEqual({ 'user.password': '[redacted]' })
  })

  it('writes a batch of two hundred in one go', async () => {
    const log = createLogger({
      apiKey: KEY,
      service: 'bulk',
      transport: { endpoint, flushIntervalMs: 0 },
    })

    for (let index = 0; index < 200; index += 1) {
      log.info(`bulk ${index}`, { index })
    }
    await log.flush()

    const rows = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs WHERE service = 'bulk'`,
    )

    expect(Number(rows[0]?.total ?? '0')).toBe(200)
  })

  it('counts what it wrote in the rollup the dashboard will read', async () => {
    const rows = await queryRows<{ total: string }>(
      config,
      `SELECT toString(sum(events)) AS total FROM ${database}.logs_per_minute
       WHERE project_id = 'p_demo' AND environment_id = 'e_dev'`,
    )
    const stored = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs`,
    )

    expect(rows[0]?.total).toBe(stored[0]?.total)
  })

  it('writes nothing at all for a key the store does not know', async () => {
    const before = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs`,
    )

    const response = await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${generateApiKey('secret')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b99',
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'intruder', runtime: 'node' },
        events: [
          { timestamp: '2026-10-31T15:30:00.000Z', level: 'info', message: 'should not land' },
        ],
      }),
    })

    const after = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs`,
    )

    expect(response.status).toBe(401)
    expect(after[0]?.total).toBe(before[0]?.total)
  })
})

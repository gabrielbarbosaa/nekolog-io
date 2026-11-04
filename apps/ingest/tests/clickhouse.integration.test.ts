import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateApiKey, hashApiKey, type KeyRecord, memoryKeyStore } from '@nekolog-io/adapters'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@nekolog-io/clickhouse'
import { clickHouseLogStore } from '@nekolog-io/clickhouse/log-store'
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
const RETENTION_DAYS = 7
const RECORD: KeyRecord = {
  projectId: 'p_demo',
  environmentId: 'e_dev',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
  retentionDays: RETENTION_DAYS,
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
    expect(String(row?.fingerprint)).toMatch(/^\d+$/)
    expect(String(row?.fingerprint)).not.toBe('0')
  })

  it('gives one fingerprint to the same error thrown twice, and none to an info log', async () => {
    const log = createLogger({
      apiKey: KEY,
      service: 'checkout-api',
      transport: { endpoint, flushIntervalMs: 0 },
    })

    const blowUp = (): never => {
      throw new RangeError('out of stock')
    }

    for (const order of ['ord_1', 'ord_2']) {
      try {
        blowUp()
      } catch (error) {
        log.child({ attributes: { order } }).error(error)
      }
    }
    log.info('nothing is wrong here')
    await log.flush()

    const errors = await storedWhere("error_type = 'RangeError'")
    expect(errors).toHaveLength(2)
    expect(new Set(errors.map((row) => String(row.fingerprint))).size).toBe(1)
    expect(String(errors[0]?.fingerprint)).not.toBe('0')

    const [calm] = await storedWhere("message = 'nothing is wrong here'")
    expect(String(calm?.fingerprint)).toBe('0')
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

  async function post(events: Array<Record<string, unknown>>, batchId: string): Promise<number> {
    const response = await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId,
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'clock', runtime: 'node' },
        events,
      }),
    })
    return response.status
  }

  it('keeps a log from a clock years behind, which ClickHouse would drop at the insert', async () => {
    const status = await post(
      [{ timestamp: '2020-01-01T00:00:00.000Z', level: 'error', message: 'from a dead clock' }],
      '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b21',
    )

    const [row] = await storedWhere("message = 'from a dead clock'")

    expect(status).toBe(202)
    expect(row).toBeDefined()
    expect(String(row?.timestamp)).not.toContain('2020')

    const skew = Number(row?.clock_skew_ms)
    const stored = Date.parse(`${String(row?.timestamp).replace(' ', 'T')}Z`)
    const received = Date.parse(`${String(row?.received_at).replace(' ', 'T')}Z`)

    expect(received - skew).toBe(Date.UTC(2020, 0, 1))
    expect(stored).toBe(received - (RETENTION_DAYS * 86_400_000 - 3_600_000))
  })

  it('writes that same event unchanged when the floor is removed, and ClickHouse eats it', async () => {
    await execute(
      config,
      `INSERT INTO ${database}.logs (project_id, environment_id, timestamp, received_at, level, message, service, retention_days)
       VALUES ('p_demo', 'e_dev', '2020-01-01 00:00:00.000', now64(3), 'error', 'unfloored', 'clock', 7)`,
    )

    const rows = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs WHERE message = 'unfloored'`,
    )

    expect(rows[0]?.total).toBe('0')
  })

  it('caps a log from a clock set to 2099, so a period query can still reach it', async () => {
    const status = await post(
      [{ timestamp: '2099-01-01T00:00:00.000Z', level: 'warn', message: 'from the future' }],
      '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b22',
    )

    const [row] = await storedWhere("message = 'from the future'")

    expect(status).toBe(202)
    expect(String(row?.timestamp)).not.toContain('2099')
    expect(Number(row?.clock_skew_ms)).toBeLessThan(-2_147_483_647)

    const reachable = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs
       WHERE message = 'from the future' AND timestamp BETWEEN now64(3) - INTERVAL 1 HOUR AND now64(3) + INTERVAL 1 HOUR`,
    )
    expect(reachable[0]?.total).toBe('1')
  })

  it('never writes what the environment minimum level keeps out', async () => {
    const quietKey = generateApiKey('secret')
    await keyStore.set(await hashApiKey(quietKey), { ...RECORD, minLevel: 'warn' })

    const response = await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${quietKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b31',
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'quiet', runtime: 'node' },
        events: [
          { timestamp: new Date().toISOString(), level: 'debug', message: 'too quiet to keep' },
          { timestamp: new Date().toISOString(), level: 'error', message: 'loud enough to keep' },
        ],
      }),
    })

    const kept = await storedWhere("service = 'quiet'")

    expect(response.status).toBe(202)
    expect(kept.map((row) => row.message)).toEqual(['loud enough to keep'])
  })

  it('never samples out an error, however low the rate', async () => {
    const sampledKey = generateApiKey('secret')
    await keyStore.set(await hashApiKey(sampledKey), { ...RECORD, sampleRate: 0.0001 })

    await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sampledKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b32',
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'sampled', runtime: 'node' },
        events: Array.from({ length: 20 }, (_, at) => ({
          timestamp: new Date().toISOString(),
          level: at % 2 === 0 ? 'info' : 'error',
          message: `sampled ${at}`,
        })),
      }),
    })

    const kept = await storedWhere("service = 'sampled'")
    const levels = kept.map((row) => row.level)

    expect(levels.filter((level) => level === 'error')).toHaveLength(10)
    expect(levels.filter((level) => level === 'info').length).toBeLessThan(10)
  })

  it('never writes what the environment asked to be removed', async () => {
    const privateKey = generateApiKey('secret')
    await keyStore.set(await hashApiKey(privateKey), {
      ...RECORD,
      redaction: { patterns: ['email', 'cpf'], attributes: ['headers.*'] },
    })

    await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${privateKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b41',
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'private', runtime: 'node' },
        events: [
          {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'ana@example.com could not pay, cpf 123.456.789-09',
            attributes: {
              'headers.authorization': 'Bearer abcdefghijklmnop',
              'user.contact': 'ana@example.com',
              orderId: 'ord_7',
            },
          },
        ],
      }),
    })

    const [row] = await storedWhere("service = 'private'")

    expect(row?.message).toBe('[redacted] could not pay, cpf [redacted]')
    expect(row?.attributes).toEqual({
      'headers.authorization': '[redacted]',
      'user.contact': '[redacted]',
      orderId: 'ord_7',
    })
    expect(JSON.stringify(row)).not.toContain('ana@example.com')
    expect(JSON.stringify(row)).not.toContain('123.456.789-09')
  })

  it('removes everything it knows when the stored rule cannot be read', async () => {
    const brokenKey = generateApiKey('secret')
    await keyStore.set(await hashApiKey(brokenKey), {
      ...RECORD,
      redaction: { patterns: ['regex:.*'] },
    })

    await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${brokenKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b42',
        sdk: { name: '@nekolog-io/node', version: '0.0.0' },
        resource: { service: 'broken-rule', runtime: 'node' },
        events: [
          {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'ana@example.com could not pay',
          },
        ],
      }),
    })

    const [row] = await storedWhere("service = 'broken-rule'")

    expect(row?.message).not.toContain('ana@example.com')
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

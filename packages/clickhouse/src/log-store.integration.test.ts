import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, ping, queryRows } from './client.ts'
import { clickHouseLogStore } from './log-store.ts'
import { migrate } from './runner.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_store_${process.pid}`
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
    `\nSkipping the LogStore integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: 'p_1',
    environment_id: 'e_1',
    timestamp: '2026-10-31 15:30:00.000',
    received_at: '2026-10-31 15:30:45.125',
    level: 'info',
    message: 'Pedido criado',
    service: 'checkout-api',
    release: '1.4.2',
    source: 'node',
    trace_id: '',
    span_id: '',
    session_id: '',
    user_id: '',
    fingerprint: 0,
    error_type: '',
    stacktrace: '',
    attributes: { orderId: '123' },
    country: 'BR',
    retention_days: 30,
    ...overrides,
  }
}

async function countWhere(where: string): Promise<number> {
  const rows = await queryRows<{ total: string }>(
    config,
    `SELECT toString(count()) AS total FROM ${database}.logs WHERE ${where}`,
  )
  return Number(rows[0]?.total ?? '0')
}

describe.skipIf(!reachable)('the ClickHouse LogStore against a real server', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
  }, 60_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('writes a row the table actually accepts', async () => {
    const store = clickHouseLogStore(config)

    const result = await store.insert([row({ message: 'first write' })])

    expect(result).toEqual({ accepted: 1 })
    expect(await countWhere("message = 'first write'")).toBe(1)
  })

  it('keeps every column it was given', async () => {
    const store = clickHouseLogStore(config)
    await store.insert([
      row({
        message: 'full row',
        trace_id: 'a'.repeat(32),
        span_id: 'b'.repeat(16),
        session_id: 's_1',
        user_id: 'u_42',
        error_type: 'TypeError',
        stacktrace: 'at pay (app.js:1:1)',
        attributes: { orderId: '123', 'error.message': 'upstream timeout' },
      }),
    ])

    const [stored] = await queryRows<Record<string, unknown>>(
      config,
      `SELECT * FROM ${database}.logs WHERE message = 'full row'`,
    )

    expect(stored).toMatchObject({
      project_id: 'p_1',
      environment_id: 'e_1',
      level: 'info',
      service: 'checkout-api',
      release: '1.4.2',
      source: 'node',
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      session_id: 's_1',
      user_id: 'u_42',
      error_type: 'TypeError',
      stacktrace: 'at pay (app.js:1:1)',
      country: 'BR',
      retention_days: 30,
    })
    expect(stored?.attributes).toEqual({ orderId: '123', 'error.message': 'upstream timeout' })
    expect(String(stored?.timestamp)).toContain('2026-10-31 15:30:00')
  })

  it('writes a whole batch in one request', async () => {
    const store = clickHouseLogStore(config)
    const rows = Array.from({ length: 50 }, (_, index) =>
      row({ message: `batched ${index}`, session_id: 'batch-of-fifty' }),
    )

    await store.insert(rows)

    expect(await countWhere("session_id = 'batch-of-fifty'")).toBe(50)
  })

  it('does not write the same batch twice when it carries the same token', async () => {
    const store = clickHouseLogStore(config)
    const token = `01933b9e-7c1a-7d4f-9a51-3f0f6c2e${process.pid.toString(16).padStart(4, '0')}`
    const rows = [row({ message: 'resent', session_id: 'dedup-me' })]

    await store.insert(rows, { deduplicationToken: token })
    await store.insert(rows, { deduplicationToken: token })

    expect(await countWhere("session_id = 'dedup-me'")).toBe(1)
  })

  it('writes twice when the tokens differ, so distinct batches are never merged', async () => {
    const store = clickHouseLogStore(config)
    const rows = [row({ message: 'same text', session_id: 'two-batches' })]

    await store.insert(rows, { deduplicationToken: `token-a-${process.pid}` })
    await store.insert(rows, { deduplicationToken: `token-b-${process.pid}` })

    expect(await countWhere("session_id = 'two-batches'")).toBe(2)
  })

  it('feeds the rollup the materialized view builds', async () => {
    const store = clickHouseLogStore(config)
    await store.insert([row({ message: 'counted', level: 'warn', service: 'rollup-check' })])

    const rows = await queryRows<{ events: string }>(
      config,
      `SELECT toString(sum(events)) AS events FROM ${database}.logs_per_minute
       WHERE service = 'rollup-check' AND level = 'warn'`,
    )

    expect(Number(rows[0]?.events ?? '0')).toBe(1)
  })

  it('raises on a column the table does not have, instead of dropping it in silence', async () => {
    const store = clickHouseLogStore(config)

    await expect(store.insert([row({ message: 'drifted', renamed_column: 'x' })])).rejects.toThrow(
      /renamed_column/,
    )
    expect(await countWhere("message = 'drifted'")).toBe(0)
  })

  it('raises on a value of the wrong type rather than coercing it', async () => {
    const store = clickHouseLogStore(config)

    await expect(
      store.insert([row({ message: 'bad type', retention_days: 'thirty' })]),
    ).rejects.toThrow()
    expect(await countWhere("message = 'bad type'")).toBe(0)
  })
})

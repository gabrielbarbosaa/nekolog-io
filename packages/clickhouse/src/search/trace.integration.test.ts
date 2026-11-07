import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, ping, queryRows } from '../client.ts'
import { migrate } from '../runner.ts'
import { type LogTraceOptions, logTraceQuery } from './trace.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_trace_${process.pid}`
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
    `\nSkipping the trace integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const PROJECT = 'prj_1'
const ENVIRONMENT = 'env_prod'
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const OTHER_TRACE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const START = new Date('2026-10-31T12:00:00.000Z')

function stamp(offsetMs: number): string {
  return new Date(START.getTime() + offsetMs).toISOString().replace('T', ' ').replace('Z', '')
}

function row(message: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    environment_id: ENVIRONMENT,
    timestamp: stamp(0),
    received_at: stamp(0),
    level: 'info',
    message,
    service: 'checkout-api',
    release: '1.4.2',
    source: 'node',
    trace_id: TRACE,
    span_id: '00f067aa0ba902b7',
    session_id: '',
    user_id: '',
    fingerprint: 0,
    error_type: '',
    stacktrace: '',
    attributes: {},
    country: 'BR',
    retention_days: 3650,
    ...overrides,
  }
}

const ROWS = [
  row('clicked pay', { timestamp: stamp(0), service: 'checkout-web', source: 'browser' }),
  row('POST /orders', { timestamp: stamp(120) }),
  row('charging the gateway', { timestamp: stamp(180), service: 'payments' }),
  row('gateway timed out', { timestamp: stamp(900), service: 'payments', level: 'error' }),
  row('500 on POST /orders', { timestamp: stamp(905), level: 'error' }),
  row('another trace entirely', { timestamp: stamp(60), trace_id: OTHER_TRACE }),
  row('no trace at all', { timestamp: stamp(60), trace_id: '', span_id: '' }),
  row('same trace, other environment', { timestamp: stamp(60), environment_id: 'env_stag' }),
  row('same trace, other project', { timestamp: stamp(60), project_id: 'prj_2' }),
  row('same trace, long after', { timestamp: stamp(6 * 60 * 60 * 1000) }),
]

type Found = { message: string; service: string; source: string }

async function trace(
  traceId: string = TRACE,
  options: LogTraceOptions = {},
  environmentIds: readonly string[] = [ENVIRONMENT],
): Promise<Found[]> {
  const { sql, params } = logTraceQuery(
    traceId,
    {
      projectId: PROJECT,
      environmentIds,
      from: new Date(START.getTime() - 60_000),
      to: new Date(START.getTime() + 60 * 60 * 1000),
    },
    { database },
    { columns: ['message', 'service', 'source', 'timestamp'], ...options },
  )
  return await queryRows<Found>(config, sql, { params })
}

describe.skipIf(!reachable)('the trace view against a real ClickHouse', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
    await execute(
      config,
      `INSERT INTO ${database}.logs FORMAT JSONEachRow\n${ROWS.map((one) => JSON.stringify(one)).join('\n')}`,
      { settings: { input_format_skip_unknown_fields: '0' } },
    )
    const kept = await queryRows<{ total: string }>(config, `SELECT count() AS total FROM logs`)
    if (Number(kept[0]?.total ?? 0) < ROWS.length) {
      throw new Error(
        `ClickHouse accepted ${ROWS.length} rows and kept ${kept[0]?.total}. The table expires by ` +
          '`timestamp + retention_days`, so a row with no retention_days is dropped at the insert ' +
          'and the insert still answers 200.',
      )
    }
  }, 60_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('puts the click in the front and the request in the back on one timeline', async () => {
    const found = await trace()

    expect(found.map((one) => one.message)).toEqual([
      'clicked pay',
      'POST /orders',
      'charging the gateway',
      'gateway timed out',
      '500 on POST /orders',
    ])
    expect(found[0]?.source).toBe('browser')
    expect(found[1]?.source).toBe('node')
  })

  it('leaves out another trace, and the rows that carry none', async () => {
    const messages = (await trace()).map((one) => one.message)

    expect(messages).not.toContain('another trace entirely')
    expect(messages).not.toContain('no trace at all')
  })

  it('never answers with the rows that carry no trace, whatever is asked for', async () => {
    await expect(trace('')).rejects.toThrow(/empty trace id/)
  })

  it('stays inside the project and the environments it was given', async () => {
    const messages = (await trace()).map((one) => one.message)

    expect(messages).not.toContain('same trace, other project')
    expect(messages).not.toContain('same trace, other environment')

    const wider = (await trace(TRACE, {}, [ENVIRONMENT, 'env_stag'])).map((one) => one.message)
    expect(wider).toContain('same trace, other environment')
  })

  it('stays inside the period, so a trace id reused later is not dragged in', async () => {
    expect((await trace()).map((one) => one.message)).not.toContain('same trace, long after')
  })

  it('finds the trace however it was spelled when asked for', async () => {
    const shouted = await trace(TRACE.toUpperCase())
    expect(shouted.map((one) => one.message)).toEqual((await trace()).map((one) => one.message))
  })

  it('stops at the limit it was given', async () => {
    expect(await trace(TRACE, { limit: 2 })).toHaveLength(2)
  })
})

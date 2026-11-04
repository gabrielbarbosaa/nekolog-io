import type { AlertCondition, AlertRule } from '@nekolog-io/adapters'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alertBatchQuery, type Measurement, measurementsFrom } from './alerts.ts'
import { type ClickHouseConfig, execute, ping, queryRows } from './client.ts'
import { migrate } from './runner.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_alerts_${process.pid}`
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
    `\nSkipping the alert batch integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const PROJECT = 'prj_1'
const ENVIRONMENT = 'env_prod'
const AT = new Date('2026-11-04T12:00:00.000Z')
const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'

function stamp(minutesAgo: number): string {
  return new Date(AT.getTime() - minutesAgo * 60_000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '')
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    environment_id: ENVIRONMENT,
    timestamp: stamp(1),
    received_at: stamp(1),
    clock_skew_ms: 0,
    level: 'info',
    message: 'ordinary',
    service: 'api',
    release: '1.0.0',
    source: 'node',
    trace_id: '',
    span_id: '',
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
  ...Array.from({ length: 6 }, () => row({ level: 'error', service: 'api' })),
  ...Array.from({ length: 4 }, () => row({ level: 'info', service: 'api' })),
  row({ level: 'error', service: 'billing' }),
  row({ level: 'error', service: 'api', timestamp: stamp(45), received_at: stamp(45) }),
  row({ level: 'error', service: 'api', project_id: 'prj_2' }),
  row({ level: 'error', service: 'api', environment_id: 'env_stag' }),
]

function rule(id: string, condition: Partial<AlertCondition> = {}): AlertRule {
  return {
    id,
    projectId: PROJECT,
    environmentId: ENVIRONMENT,
    name: id,
    state: 'ok',
    stateChangedAt: null,
    lastNotifiedAt: null,
    condition: {
      type: 'threshold',
      query: '',
      window: '5m',
      operator: '>',
      value: 0,
      cooldown: '30m',
      channels: [CHANNEL],
      ...condition,
    },
  }
}

async function measure(rules: AlertRule[]): Promise<ReadonlyArray<Measurement>> {
  const batch = alertBatchQuery(rules, { projectId: PROJECT, environmentId: ENVIRONMENT }, AT, {
    database,
  })
  const rows = await queryRows<Record<string, unknown>>(config, batch.sql, {
    params: batch.params,
  })
  return measurementsFrom(batch, rows[0])
}

describe.skipIf(!reachable)('the alert batch against a real ClickHouse', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
    await execute(
      config,
      `INSERT INTO ${database}.logs FORMAT JSONEachRow\n${ROWS.map((one) => JSON.stringify(one)).join('\n')}`,
      { settings: { input_format_skip_unknown_fields: '0' } },
    )
  }, 60_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('has every fixture row in the table, so what is left out is really there', async () => {
    const rows = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs`,
    )

    expect(rows[0]?.total).toBe(String(ROWS.length))
  })

  it('counts what a threshold rule asked for, and nothing else', async () => {
    const [measurement] = await measure([rule('alr_a', { query: 'level:error service:api' })])

    expect(measurement?.matched).toBe(6)
  })

  it('answers several rules from one statement, each with its own count', async () => {
    const measurements = await measure([
      rule('alr_a', { query: 'level:error service:api' }),
      rule('alr_b', { query: 'service:billing' }),
      rule('alr_c', { query: '' }),
    ])

    expect(measurements.map((one) => one.matched)).toEqual([6, 1, 11])
  })

  it('honours each rule own window inside that one statement', async () => {
    const measurements = await measure([
      rule('alr_a', { query: 'level:error service:api', window: '5m' }),
      rule('alr_b', { query: 'level:error service:api', window: '1h' }),
    ])

    expect(measurements[0]?.matched).toBe(6)
    expect(measurements[1]?.matched).toBe(7)
  })

  it('reaches no other project and no other environment', async () => {
    const elsewhere = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs
       WHERE project_id = 'prj_2' OR environment_id = 'env_stag'`,
    )
    const [measurement] = await measure([rule('alr_a', { query: '' })])

    expect(elsewhere[0]?.total).toBe('2')
    expect(measurement?.matched).toBe(11)
  })

  it('measures an error rate as a share of what the search matched', async () => {
    const [measurement] = await measure([
      rule('alr_a', { type: 'error_rate', query: 'service:api', value: 50, minEvents: 1 }),
    ])

    expect(measurement?.matched).toBe(10)
    expect(measurement?.errors).toBe(6)
  })

  it('counts nothing for an absence rule when the service really went quiet', async () => {
    const [measurement] = await measure([
      rule('alr_a', {
        type: 'absence',
        query: 'service:checkout',
        operator: undefined,
        value: undefined,
      }),
    ])

    expect(measurement?.matched).toBe(0)
  })

  it('runs a search with an attribute, which is where the parameters matter most', async () => {
    await expect(measure([rule('alr_a', { query: '@orderId:"ord_1"' })])).resolves.toEqual([
      { ruleId: 'alr_a', matched: 0, errors: 0 },
    ])
  })
})

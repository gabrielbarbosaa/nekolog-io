import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, ping, queryRows } from '../client.ts'
import { migrate } from '../runner.ts'
import { searchWhere } from './scope.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_search_${process.pid}`
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
    `\nSkipping the search integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const PROJECT = 'prj_1'
const OTHER_PROJECT = 'prj_2'
const ENVIRONMENTS = { production: 'env_prod', staging: 'env_stag' }

const SCOPE = {
  projectId: PROJECT,
  environmentIds: [ENVIRONMENTS.production, ENVIRONMENTS.staging],
  from: new Date('2026-10-31T00:00:00.000Z'),
  to: new Date('2026-11-01T00:00:00.000Z'),
}

function row(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    environment_id: ENVIRONMENTS.production,
    timestamp: '2026-10-31 15:30:00.000',
    received_at: '2026-10-31 15:30:00.000',
    level: 'info',
    message: id,
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
    attributes: {},
    country: 'BR',
    retention_days: 3650,
    ...overrides,
  }
}

const ROWS = [
  row('timeout reading orders', { level: 'error', attributes: { orderId: '123', status: '500' } }),
  row('payment failed for card', { level: 'fatal', service: 'api-gateway' }),
  row('healthy', { level: 'debug', service: 'web', attributes: { status: '200' } }),
  row('TIMEOUT shouting', { level: 'warn', service: 'api-worker' }),
  row('staged work', { environment_id: ENVIRONMENTS.staging, level: 'error' }),
  row('another project', { project_id: OTHER_PROJECT, level: 'error' }),
  row('long ago', { timestamp: '2026-10-30 10:00:00.000', level: 'error' }),
  row('api.timeout dotted', { level: 'error', service: 'api' }),
]

async function found(search: string): Promise<string[]> {
  const { sql, params } = searchWhere(search, SCOPE, { environments: ENVIRONMENTS })
  const rows = await queryRows<{ message: string }>(
    config,
    `SELECT message FROM ${database}.logs WHERE ${sql} ORDER BY message`,
    { params },
  )
  return rows.map((found) => found.message)
}

describe.skipIf(!reachable)('the search language against a real ClickHouse', () => {
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

  it('answers an empty search with everything inside the scope', async () => {
    expect(await found('')).toEqual([
      'TIMEOUT shouting',
      'api.timeout dotted',
      'healthy',
      'payment failed for card',
      'staged work',
      'timeout reading orders',
    ])
  })

  it('never reaches another project or another period', async () => {
    const rows = await queryRows<{ message: string }>(
      config,
      `SELECT message FROM ${database}.logs WHERE message in ('another project', 'long ago')`,
    )
    expect(
      rows.map((one) => one.message).sort(),
      'both rows have to be in the table, or the scope test proves nothing',
    ).toEqual(['another project', 'long ago'])

    const everything = await found('')
    expect(everything).not.toContain('another project')
    expect(everything).not.toContain('long ago')
  })

  it('matches a word in the message without caring about case', async () => {
    expect(await found('timeout')).toEqual([
      'TIMEOUT shouting',
      'api.timeout dotted',
      'timeout reading orders',
    ])
  })

  it('matches a phrase as a substring', async () => {
    expect(await found('"payment failed"')).toEqual(['payment failed for card'])
  })

  it('matches a word a token index cannot hold', async () => {
    expect(await found('api.timeout')).toEqual(['api.timeout dotted'])
  })

  it('filters by a field', async () => {
    expect(await found('level:fatal')).toEqual(['payment failed for card'])
  })

  it('filters by several values at once', async () => {
    expect(await found('level:(fatal OR debug)')).toEqual(['healthy', 'payment failed for card'])
  })

  it('filters by a prefix', async () => {
    expect(await found('service:api-*')).toEqual(['TIMEOUT shouting', 'payment failed for card'])
  })

  it('reads an attribute by name, with the name as a parameter', async () => {
    expect(await found('@orderId:123')).toEqual(['timeout reading orders'])
  })

  it('compares an attribute as a number', async () => {
    expect(await found('@status>=500')).toEqual(['timeout reading orders'])
    expect(await found('@status>=200')).toEqual(['healthy', 'timeout reading orders'])
  })

  it('leaves a row out when the attribute is missing rather than failing', async () => {
    expect(await found('@status<9999')).toEqual(['healthy', 'timeout reading orders'])
  })

  it('narrows by environment name', async () => {
    expect(await found('env:staging')).toEqual(['staged work'])
  })

  it('negates', async () => {
    expect(await found('-level:error')).toEqual([
      'TIMEOUT shouting',
      'healthy',
      'payment failed for card',
    ])
  })

  it('combines the lot', async () => {
    expect(await found('(service:api-* OR service:web) -level:fatal')).toEqual([
      'TIMEOUT shouting',
      'healthy',
    ])
  })

  it('takes a hostile value as data, not as SQL', async () => {
    expect(await found("service:';DROP TABLE logs;--")).toEqual([])

    const stillThere = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs`,
    )
    expect(Number(stillThere[0]?.total)).toBe(ROWS.length)
  })
})

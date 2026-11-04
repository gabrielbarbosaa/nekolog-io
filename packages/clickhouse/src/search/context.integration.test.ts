import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, ping, queryRows } from '../client.ts'
import { migrate } from '../runner.ts'
import { type LogContextOptions, logContextQuery, SIDE_COLUMN } from './context.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_context_${process.pid}`
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
    `\nSkipping the log context integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const PROJECT = 'prj_1'
const ENVIRONMENT = 'env_prod'
const ANCHOR = new Date('2026-10-31T12:00:10.000Z')

function stamp(offsetSeconds: number): string {
  const when = new Date(ANCHOR.getTime() + offsetSeconds * 1000)
  return when.toISOString().replace('T', ' ').replace('Z', '')
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
  ...[-5, -4, -3, -2, -1].map((at) => row(`before ${-at}`, { timestamp: stamp(at) })),
  row('anchor a'),
  row('anchor b'),
  row('anchor c'),
  ...[1, 2, 3, 4, 5].map((at) => row(`after ${at}`, { timestamp: stamp(at) })),
  row('far away', { timestamp: stamp(7200) }),
  row('long before', { timestamp: stamp(-7200) }),
  row('other environment', { environment_id: 'env_stag' }),
  row('other project', { project_id: 'prj_2' }),
]

type Found = { message: string; context_side: number }

async function context(options: LogContextOptions = {}): Promise<Found[]> {
  const { sql, params } = logContextQuery(
    ANCHOR,
    { projectId: PROJECT, environmentId: ENVIRONMENT },
    { database },
    { columns: ['message', 'timestamp'], ...options },
  )
  const rows = await queryRows<Found>(config, sql, { params })
  return rows.map((one) => ({
    message: one.message,
    context_side: one[SIDE_COLUMN as 'context_side'],
  }))
}

describe.skipIf(!reachable)('the log context against a real ClickHouse', () => {
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

  it('returns what came before, what shares the moment, and what came after, in order', async () => {
    const found = await context({ before: 2, after: 2 })

    expect(found.map((one) => one.message)).toEqual([
      'before 2',
      'before 1',
      'anchor a',
      'anchor b',
      'anchor c',
      'after 1',
      'after 2',
    ])
    expect(found.map((one) => one.context_side)).toEqual([-1, -1, 0, 0, 0, 1, 1])
  })

  it('takes the nearest rows, not the first ones it finds', async () => {
    const found = await context({ before: 1, after: 1 })
    expect(found.map((one) => one.message)).toEqual([
      'before 1',
      'anchor a',
      'anchor b',
      'anchor c',
      'after 1',
    ])
  })

  it('caps the rows that share the anchor to the moment', async () => {
    const found = await context({ before: 0, after: 0, atMost: 2 })
    expect(found).toHaveLength(2)
    expect(found.every((one) => one.context_side === 0)).toBe(true)
  })

  it('asks for no neighbour when told zero', async () => {
    const found = await context({ before: 0, after: 0 })
    expect(found.map((one) => one.message)).toEqual(['anchor a', 'anchor b', 'anchor c'])
  })

  it('never leaves the project or the environment', async () => {
    const everything = await context({ before: 200, after: 200, windowMs: 7 * 24 * 60 * 60 * 1000 })
    const messages = everything.map((one) => one.message)

    expect(messages).not.toContain('other project')
    expect(messages).not.toContain('other environment')
    expect(messages).toContain('far away')
    expect(messages).toContain('long before')
  })

  it('does not look past the window at either end, which is what prunes the partitions', async () => {
    const outside = await queryRows<{ message: string }>(
      config,
      `SELECT message FROM ${database}.logs WHERE message in ('far away', 'long before')`,
    )
    expect(
      outside.map((one) => one.message).sort(),
      'both rows have to be in the table, or this test proves nothing',
    ).toEqual(['far away', 'long before'])

    const near = (await context({ before: 200, after: 200, windowMs: 60_000 })).map(
      (one) => one.message,
    )
    expect(near).not.toContain('far away')
    expect(near).not.toContain('long before')
  })

  it('narrows by a search when the caller asks for one', async () => {
    const found = await context({ before: 5, after: 5, search: '"before"' })
    expect(found.map((one) => one.message)).toEqual([
      'before 5',
      'before 4',
      'before 3',
      'before 2',
      'before 1',
    ])
  })

  it('takes a hostile search as data', async () => {
    const found = await context({ before: 5, after: 5, search: "service:';DROP TABLE logs;--" })
    expect(found).toEqual([])

    const left = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs`,
    )
    expect(Number(left[0]?.total)).toBe(ROWS.length)
  })
})

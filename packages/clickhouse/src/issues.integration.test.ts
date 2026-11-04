import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, ping } from './client.ts'
import { clickHouseIssueSource } from './issues.ts'
import { migrate } from './runner.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_issues_${process.pid}`
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
    `\nSkipping the issue rollup integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const WINDOW_FROM = Date.UTC(2026, 9, 31, 12, 0, 0)
const WINDOW_TO = WINDOW_FROM + 60_000

function at(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '')
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: 'prj_1',
    environment_id: 'env_prod',
    timestamp: at(WINDOW_FROM + 1000),
    received_at: at(WINDOW_FROM + 1000),
    level: 'error',
    message: 'boom',
    service: 'checkout-api',
    release: '1.4.2',
    source: 'node',
    trace_id: '',
    span_id: '',
    session_id: '',
    user_id: '',
    fingerprint: '111',
    error_type: 'TypeError',
    stacktrace: '',
    attributes: {},
    country: 'BR',
    retention_days: 3650,
    ...overrides,
  }
}

const ROWS = [
  row({ timestamp: at(WINDOW_FROM + 1000) }),
  row({ timestamp: at(WINDOW_FROM + 40_000), message: 'boom again' }),
  row({ environment_id: 'env_stag', fingerprint: '111' }),
  row({ fingerprint: '222', message: 'different error', error_type: 'RangeError' }),
  row({ fingerprint: '0', level: 'info', message: 'not an error' }),
  row({ project_id: 'prj_2', fingerprint: '111', message: 'another project' }),
  row({
    fingerprint: '333',
    message: 'arrived late',
    received_at: at(WINDOW_TO + 5000),
  }),
  row({
    fingerprint: '444',
    message: 'backdated by the client',
    timestamp: at(WINDOW_FROM - 86_400_000),
  }),
  row({ fingerprint: '18446744073709551615', message: 'the biggest fingerprint there is' }),
]

describe.skipIf(!reachable)('the issue rollup against a real ClickHouse', () => {
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

  it('groups by project, environment and fingerprint', async () => {
    const found = await clickHouseIssueSource(config).occurrencesBetween({
      from: WINDOW_FROM,
      to: WINDOW_TO,
    })

    const sameError = found.filter((one) => one.fingerprint === '111' && one.projectId === 'prj_1')
    expect(sameError).toHaveLength(2)
    expect(sameError.map((one) => one.environmentId).sort()).toEqual(['env_prod', 'env_stag'])

    const production = sameError.find((one) => one.environmentId === 'env_prod')
    expect(production?.events).toBe(2)
    expect(production?.firstSeen).toBe(WINDOW_FROM + 1000)
    expect(production?.lastSeen).toBe(WINDOW_FROM + 40_000)
    expect(production?.title).toBe('boom again')
    expect(production?.errorType).toBe('TypeError')
  })

  it('leaves out a row that was never fingerprinted', async () => {
    const found = await clickHouseIssueSource(config).occurrencesBetween({
      from: WINDOW_FROM,
      to: WINDOW_TO,
    })

    expect(found.map((one) => one.title)).not.toContain('not an error')
    expect(found.every((one) => one.fingerprint !== '0')).toBe(true)
  })

  it('windows by when the server received it, not by the time the client claimed', async () => {
    const found = await clickHouseIssueSource(config).occurrencesBetween({
      from: WINDOW_FROM,
      to: WINDOW_TO,
    })
    const titles = found.map((one) => one.title)

    expect(titles).not.toContain('arrived late')
    expect(titles).toContain('backdated by the client')
  })

  it('keeps a fingerprint that does not fit in a double', async () => {
    const found = await clickHouseIssueSource(config).occurrencesBetween({
      from: WINDOW_FROM,
      to: WINDOW_TO,
    })
    const biggest = found.find((one) => one.title === 'the biggest fingerprint there is')

    expect(biggest?.fingerprint).toBe('18446744073709551615')
  })

  it('takes at most the number of groups it was asked for', async () => {
    const found = await clickHouseIssueSource(config, { limit: 2 }).occurrencesBetween({
      from: WINDOW_FROM,
      to: WINDOW_TO,
    })

    expect(found).toHaveLength(2)
  })
})

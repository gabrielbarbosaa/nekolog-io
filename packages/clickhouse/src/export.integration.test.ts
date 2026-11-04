import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, ping, queryRows } from './client.ts'
import { compileExport, type ExportFormat, type ExportRequest } from './export.ts'
import { migrate } from './runner.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_export_${process.pid}`
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
    `\nSkipping the export integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const S3_ENDPOINT = process.env.EXPORT_S3_TEST_ENDPOINT ?? ''
const S3_ACCESS_KEY = process.env.EXPORT_S3_TEST_ACCESS_KEY ?? ''
const S3_SECRET = process.env.EXPORT_S3_TEST_SECRET ?? ''
const s3Configured = S3_ENDPOINT !== '' && S3_ACCESS_KEY !== '' && S3_SECRET !== ''

if (reachable && !s3Configured) {
  if (process.env.EXPORT_S3_TEST_REQUIRED === '1') {
    throw new Error(
      'EXPORT_S3_TEST_REQUIRED is set but EXPORT_S3_TEST_ENDPOINT, _ACCESS_KEY and _SECRET are not all set.',
    )
  }
  process.stderr.write(
    '\nSkipping the export round trip through an object store: no EXPORT_S3_TEST_ENDPOINT.\n' +
      'The statement itself is still exercised against ClickHouse; only the write to S3 is skipped.\n' +
      'Set it to a bucket ClickHouse itself can reach, like http://garage:3900/nekolog-dev.\n\n',
  )
}

const PROJECT = 'prj_1'
const ENVIRONMENT = 'env_prod'
const HOSTILE = '=cmd|/c calc'

function stamp(iso: string): string {
  return iso.replace('T', ' ').replace('Z', '')
}

function row(message: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: PROJECT,
    environment_id: ENVIRONMENT,
    timestamp: stamp('2026-10-01T12:00:00.000Z'),
    received_at: stamp('2026-10-01T12:00:00.000Z'),
    clock_skew_ms: 0,
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
    attributes: { orderId: '=SUM(1)' },
    country: 'BR',
    retention_days: 3650,
    ...overrides,
  }
}

const ROWS = [
  row(HOSTILE, { timestamp: stamp('2026-10-01T12:00:00.000Z') }),
  row('ordinary line', { timestamp: stamp('2026-10-01T12:00:01.000Z') }),
  row('-1 looks like a formula too', { timestamp: stamp('2026-10-01T12:00:02.000Z') }),
  row('from another project', { project_id: 'prj_2' }),
  row('from another environment', { environment_id: 'env_stag' }),
  row('outside the period', { timestamp: stamp('2026-09-01T12:00:00.000Z') }),
]

const REQUEST: Omit<ExportRequest, 'format'> = {
  exportId: 'exp_01JBQ8R4T7V2WXYZ0123456789',
  scope: {
    projectId: PROJECT,
    environmentIds: [ENVIRONMENT],
    from: new Date('2026-10-01T00:00:00.000Z'),
    to: new Date('2026-10-02T00:00:00.000Z'),
  },
  destination: {
    endpoint: S3_ENDPOINT === '' ? 'http://localhost:1/bucket' : S3_ENDPOINT,
    accessKeyId: S3_ACCESS_KEY === '' ? 'placeholder' : S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET === '' ? 'placeholder' : S3_SECRET,
  },
  target: { database },
}

function compile(format: ExportFormat, search?: string) {
  return compileExport({ ...REQUEST, format, ...(search === undefined ? {} : { search }) })
}

async function selected(format: ExportFormat, search?: string): Promise<string[]> {
  const { select, params } = compile(format, search)
  const rows = await queryRows<{ message: string }>(config, select, { params })
  return rows.map((one) => one.message)
}

describe.skipIf(!reachable)('the export statement against a real ClickHouse', () => {
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

  it('has all six rows in the table, so what the export leaves out is really there', async () => {
    const rows = await queryRows<{ total: string }>(
      config,
      `SELECT toString(count()) AS total FROM ${database}.logs`,
    )

    expect(rows[0]?.total).toBe(String(ROWS.length))
  })

  it('runs at all, which is what proves the guard survives LowCardinality columns', async () => {
    await expect(selected('csv')).resolves.toBeInstanceOf(Array)
  })

  it('prefixes a message a spreadsheet would run, and only in CSV', async () => {
    expect(await selected('csv')).toContain(`'${HOSTILE}`)
    expect(await selected('json')).toContain(HOSTILE)
    expect(await selected('xml')).toContain(HOSTILE)
  })

  it('prefixes a leading minus too, which Excel also evaluates', async () => {
    expect(await selected('csv')).toContain("'-1 looks like a formula too")
  })

  it('leaves an ordinary line exactly as it was', async () => {
    for (const format of ['csv', 'json', 'xml'] as const) {
      expect(await selected(format)).toContain('ordinary line')
    }
  })

  it('reaches no other project, environment or period', async () => {
    const messages = await selected('csv')

    expect(messages).not.toContain('from another project')
    expect(messages).not.toContain('from another environment')
    expect(messages).not.toContain('outside the period')
    expect(messages).toHaveLength(3)
  })

  it('narrows further when the reader asked for a filter', async () => {
    expect(await selected('csv', 'ordinary')).toEqual(['ordinary line'])
  })

  it('returns the rows oldest first, which is the order a log file is read in', async () => {
    expect(await selected('json')).toEqual([
      HOSTILE,
      'ordinary line',
      '-1 looks like a formula too',
    ])
  })
})

describe.skipIf(!reachable || !s3Configured)('the whole export, into an object store', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
    await execute(
      config,
      `INSERT INTO ${database}.logs FORMAT JSONEachRow\n${ROWS.map((one) => JSON.stringify(one)).join('\n')}`,
      { settings: { input_format_skip_unknown_fields: '0' } },
    )
  }, 60_000)

  it('writes a gzipped CSV whose hostile cell comes back prefixed', async () => {
    const { sql, params, url } = compile('csv')

    await execute(config, sql, { params })

    const back = await queryRows<{ message: string }>(
      config,
      `SELECT message FROM s3('${url.replace('.csv.gz', '*.csv.gz')}', '${S3_ACCESS_KEY}', '${S3_SECRET}', 'CSVWithNames')`,
    )

    expect(back.map((one) => one.message)).toContain(`'${HOSTILE}`)
  }, 60_000)

  it('writes NDJSON that keeps the message as it was logged', async () => {
    const { sql, params, url } = compile('json')

    await execute(config, sql, { params })

    const back = await queryRows<{ message: string }>(
      config,
      `SELECT message FROM s3('${url.replace('.ndjson.gz', '*.ndjson.gz')}', '${S3_ACCESS_KEY}', '${S3_SECRET}', 'JSONEachRow')`,
    )

    expect(back.map((one) => one.message)).toContain(HOSTILE)
  }, 60_000)
})

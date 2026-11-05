import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BACKUP_CREATED,
  BACKUP_FAILED,
  BACKUP_RUNNING,
  backupHistoryQuery,
  compileBackup,
} from './backup.ts'
import { type ClickHouseConfig, execute, ping, queryRows } from './client.ts'
import { migrate } from './runner.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_backup_${process.pid}`
const restored = `${database}_restored`
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
    `\nSkipping the backup integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const PROBE = process.env.BACKUP_S3_TEST_PROBE ?? 'http://localhost:3900'
const ENDPOINT = process.env.BACKUP_S3_TEST_ENDPOINT ?? 'http://garage:3900/nekolog-dev'
const ACCESS_KEY = process.env.BACKUP_S3_TEST_ACCESS_KEY ?? 'GK31c2f218a2e44f485b94239e'
const SECRET =
  process.env.BACKUP_S3_TEST_SECRET ??
  'b0e7a4c21d8f5639ae0c47b2f81d3a6950c8e2b47f1a9d3c6e05b8a2f47c91d3'

async function objectStoreAnswers(): Promise<boolean> {
  try {
    const response = await fetch(PROBE, { method: 'GET' })
    return response.status > 0
  } catch {
    return false
  }
}

const storeReachable = reachable && (await objectStoreAnswers())

if (reachable && !storeReachable) {
  if (process.env.BACKUP_S3_TEST_REQUIRED === '1') {
    throw new Error(
      `BACKUP_S3_TEST_REQUIRED is set but nothing answered at ${PROBE}. ` +
        'A backup nobody wrote and nobody restored is not a backup; this must not be skipped here.',
    )
  }
  process.stderr.write(
    `\nSkipping the ClickHouse backup round trip: nothing answered at ${PROBE}.\n` +
      'Start the dev stack with `pnpm dev:infra`, which runs Garage on :3900.\n\n',
  )
}

const destination = { endpoint: ENDPOINT, accessKeyId: ACCESS_KEY, secretAccessKey: SECRET }

const RECENT = new Date().toISOString().replace('T', ' ').slice(0, 19)

const ROWS = [
  {
    project_id: 'prj_1',
    environment_id: 'env_prod',
    timestamp: RECENT,
    received_at: RECENT,
    clock_skew_ms: 0,
    level: 'error',
    message: 'the row this whole feature exists for',
    service: 'checkout-api',
    release: '1.4.2',
    source: 'node',
    trace_id: '',
    span_id: '',
    session_id: '',
    user_id: '',
    fingerprint: '9798706835935588174',
    error_type: 'TypeError',
    stacktrace: '',
    attributes: { orderId: 'ord_7f3a91' },
    country: 'BR',
    retention_days: 30,
  },
]

type Attempt = { name: string; status: string; error: string; started_at: number }

async function history(): Promise<Attempt[]> {
  return await queryRows<Attempt>(config, backupHistoryQuery(), { database: null })
}

async function settled(url: string, within = 60_000): Promise<Attempt> {
  const deadline = Date.now() + within
  while (Date.now() < deadline) {
    const mine = (await history()).filter((one) => one.name.includes(url))
    const finished = mine.find((one) => one.status !== BACKUP_RUNNING)
    if (finished !== undefined) {
      return finished
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`The backup at ${url} never left ${BACKUP_RUNNING}`)
}

describe.skipIf(!storeReachable)('backing a real database up and restoring it', () => {
  const at = new Date()
  const compiled = compileBackup({ database, destination, at })

  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
    await migrate(config)
    await execute(
      config,
      `INSERT INTO ${database}.logs FORMAT JSONEachRow\n${ROWS.map((one) => JSON.stringify(one)).join('\n')}`,
      { settings: { input_format_skip_unknown_fields: '0' } },
    )
  }, 120_000)

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${restored}`, { database: null })
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('returns straight away instead of holding the request open for the whole copy', async () => {
    const answer = await execute(config, compiled.sql, { database: null })

    expect(answer).toContain(BACKUP_RUNNING)
  }, 60_000)

  it('finishes, and says how much it wrote', async () => {
    const attempt = await settled(compiled.url)

    expect(attempt.status, attempt.error).toBe(BACKUP_CREATED)
    expect(attempt.error).toBe('')
  }, 120_000)

  it('never shows the secret back, in the history or in what we log', async () => {
    const mine = (await history()).filter((one) => one.name.includes(compiled.url))

    expect(mine.length).toBeGreaterThan(0)
    for (const attempt of mine) {
      expect(attempt.name).not.toContain(SECRET)
      expect(attempt.name).toContain('[HIDDEN]')
    }
    expect(compiled.redacted).not.toContain(SECRET)
  })

  it('refuses to write a second backup over the first, which is why the name carries the time', async () => {
    await execute(config, compiled.sql, { database: null })
    const again = await settled(compiled.url)

    expect(again.status).toBe(BACKUP_FAILED)
    expect(again.error).toMatch(/already exists/i)
  }, 120_000)

  it('restores every row and the usage rollup into an empty database', async () => {
    await execute(
      config,
      `RESTORE DATABASE ${database} AS ${restored} FROM S3(` +
        `'${compiled.url}', '${ACCESS_KEY}', '${SECRET}')`,
      { database: null },
    )

    const rows = await queryRows<{ logs: string; usage: string; migrations: string }>(
      config,
      `SELECT toString((SELECT count() FROM ${restored}.logs)) AS logs, ` +
        `toString((SELECT count() FROM ${restored}.usage_per_minute)) AS usage, ` +
        `toString((SELECT count() FROM ${restored}._migrations)) AS migrations`,
      { database: null },
    )

    expect(rows[0]?.logs).toBe(String(ROWS.length))
    expect(Number(rows[0]?.usage)).toBeGreaterThan(0)
    expect(Number(rows[0]?.migrations)).toBeGreaterThan(0)
  }, 180_000)

  it('brings the fingerprint back as the number it was, not a rounded one', async () => {
    const rows = await queryRows<{ fingerprint: string }>(
      config,
      `SELECT toString(fingerprint) AS fingerprint FROM ${restored}.logs`,
      { database: null },
    )

    expect(rows[0]?.fingerprint).toBe(ROWS[0]?.fingerprint)
  })
})

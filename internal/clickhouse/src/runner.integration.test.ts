import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ClickHouseConfig, execute, ping, queryRows } from './client.ts'
import { loadMigrations } from './migrations.ts'
import { MIGRATIONS_TABLE, migrate, status } from './runner.ts'

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const database = `nekolog_test_${process.pid}`
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
    `\nSkipping ClickHouse integration tests: nothing answered at ${base.url}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

describe.skipIf(!reachable)('the migration runner against a real ClickHouse', () => {
  beforeAll(async () => {
    await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
  })

  afterAll(async () => {
    await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  })

  it('refuses to run against a database that does not exist', async () => {
    await expect(status({ ...base, database: 'nekolog_absent_xyz' })).rejects.toThrow(
      /does not exist/,
    )
  })

  it('applies every shipped migration on the first run', async () => {
    const result = await migrate(config)

    expect(result.applied.map((entry) => entry.fileName)).toEqual(
      loadMigrations().map((entry) => entry.fileName),
    )
  })

  it('creates the logs table, both rollups and their materialized views', async () => {
    const rows = await queryRows<{ name: string }>(
      config,
      `SELECT name FROM system.tables WHERE database = '${database}' ORDER BY name`,
    )

    expect(rows.map((row) => row.name)).toEqual([
      MIGRATIONS_TABLE,
      'logs',
      'logs_per_minute',
      'logs_per_minute_mv',
      'usage_per_minute',
      'usage_per_minute_mv',
    ])
  })

  it('records one row per migration, with its checksum', async () => {
    const shipped = loadMigrations()
    const rows = await queryRows<{ version: number; checksum: string }>(
      config,
      `SELECT version, checksum FROM ${database}.${MIGRATIONS_TABLE} ORDER BY version`,
    )

    expect(rows).toEqual(
      shipped.map((entry) => ({ version: entry.version, checksum: entry.checksum })),
    )
  })

  it('applies nothing on a second run', async () => {
    const result = await migrate(config)

    expect(result.applied).toEqual([])
  })

  it('feeds the materialized view when a log is inserted', async () => {
    await execute(
      config,
      `INSERT INTO ${database}.logs (project_id, environment_id, timestamp, received_at, level, message, service, retention_days) FORMAT JSONEachRow ${JSON.stringify(
        {
          project_id: 'p1',
          environment_id: 'e1',
          timestamp: '2026-10-30 12:00:00.000',
          received_at: '2026-10-30 12:00:01.000',
          level: 'error',
          message: 'Payment failed',
          service: 'api',
          retention_days: 30,
        },
      )}`,
    )

    const rows = await queryRows<{ level: string; service: string; events: string }>(
      config,
      `SELECT level, service, toString(sum(events)) AS events
         FROM ${database}.logs_per_minute
        WHERE project_id = 'p1'
        GROUP BY level, service`,
    )

    expect(rows).toEqual([{ level: 'error', service: 'api', events: '1' }])
  })

  it('stops when an applied migration was edited afterwards', async () => {
    const [first] = loadMigrations()
    const tampered = { ...(first as NonNullable<typeof first>), checksum: 'tampered' }

    await expect(migrate(config, { migrations: [tampered] })).rejects.toThrow(
      /already applied and since edited/,
    )
  })
})

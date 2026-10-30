import { type ClickHouseConfig, databaseExists, execute, queryRows } from './client.ts'
import { loadMigrations, type Migration, renderSql } from './migrations.ts'

export const MIGRATIONS_TABLE = '_migrations'
export const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type MigrationState = 'applied' | 'pending' | 'drifted'

export type MigrationStatus = {
  version: number
  name: string
  fileName: string
  state: MigrationState
  appliedAt: string | null
}

export type StatusReport = {
  database: string
  entries: MigrationStatus[]
  orphans: AppliedMigration[]
}

type AppliedMigration = {
  version: number
  name: string
  checksum: string
  applied_at: string
}

export class MigrationStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationStateError'
  }
}

export function assertDatabaseName(database: string): void {
  if (!DATABASE_NAME_PATTERN.test(database)) {
    throw new MigrationStateError(
      `CLICKHOUSE_DB must be a bare identifier, got ${JSON.stringify(database)}`,
    )
  }
}

export async function assertDatabaseReady(config: ClickHouseConfig): Promise<void> {
  assertDatabaseName(config.database)
  if (!(await databaseExists(config))) {
    throw new MigrationStateError(
      `database ${config.database} does not exist on ${config.url}; create it before running migrations`,
    )
  }
}

export async function ensureMigrationsTable(config: ClickHouseConfig): Promise<void> {
  await execute(
    config,
    `CREATE TABLE IF NOT EXISTS ${config.database}.${MIGRATIONS_TABLE} (
       version UInt32,
       name String,
       checksum String,
       applied_at DateTime DEFAULT now()
     ) ENGINE = MergeTree ORDER BY version`,
  )
}

export async function readApplied(config: ClickHouseConfig): Promise<AppliedMigration[]> {
  return queryRows<AppliedMigration>(
    config,
    `SELECT version, name, checksum, toString(applied_at) AS applied_at
       FROM ${config.database}.${MIGRATIONS_TABLE}
      ORDER BY version`,
  )
}

export function buildStatus(
  database: string,
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
): StatusReport {
  const byVersion = new Map(applied.map((row) => [row.version, row]))

  const entries = migrations.map((migration): MigrationStatus => {
    const row = byVersion.get(migration.version)
    if (!row) {
      return {
        version: migration.version,
        name: migration.name,
        fileName: migration.fileName,
        state: 'pending',
        appliedAt: null,
      }
    }
    return {
      version: migration.version,
      name: migration.name,
      fileName: migration.fileName,
      state: row.checksum === migration.checksum ? 'applied' : 'drifted',
      appliedAt: row.applied_at,
    }
  })

  const known = new Set(migrations.map((migration) => migration.version))
  const orphans = applied.filter((row) => !known.has(row.version))

  return { database, entries, orphans }
}

export function assertNoDrift(report: StatusReport): void {
  const drifted = report.entries.filter((entry) => entry.state === 'drifted')
  if (drifted.length > 0) {
    const names = drifted.map((entry) => entry.fileName).join(', ')
    throw new MigrationStateError(
      `already applied and since edited: ${names}. An applied migration is never changed — revert the edit and add a new migration instead.`,
    )
  }

  if (report.orphans.length > 0) {
    const names = report.orphans.map((row) => `${row.version} (${row.name})`).join(', ')
    throw new MigrationStateError(
      `applied in ${report.database} but missing from the migrations directory: ${names}. Restore the files instead of deleting them.`,
    )
  }

  const firstPending = report.entries.findIndex((entry) => entry.state === 'pending')
  if (firstPending !== -1) {
    const appliedAfter = report.entries
      .slice(firstPending + 1)
      .filter((entry) => entry.state !== 'pending')
    if (appliedAfter.length > 0) {
      throw new MigrationStateError(
        `${report.entries[firstPending]?.fileName} is pending but later migrations are already applied (${appliedAfter
          .map((entry) => entry.fileName)
          .join(', ')}). Applying it now would run out of order.`,
      )
    }
  }
}

export async function status(
  config: ClickHouseConfig,
  migrations: readonly Migration[] = loadMigrations(),
): Promise<StatusReport> {
  await assertDatabaseReady(config)
  await ensureMigrationsTable(config)
  return buildStatus(config.database, migrations, await readApplied(config))
}

export type MigrateResult = {
  applied: Migration[]
  report: StatusReport
}

export async function migrate(
  config: ClickHouseConfig,
  options: { migrations?: readonly Migration[]; onApply?: (migration: Migration) => void } = {},
): Promise<MigrateResult> {
  const migrations = options.migrations ?? loadMigrations()
  const report = await status(config, migrations)
  assertNoDrift(report)

  const pending = report.entries
    .filter((entry) => entry.state === 'pending')
    .map(
      (entry) => migrations.find((migration) => migration.version === entry.version) as Migration,
    )

  const applied: Migration[] = []
  for (const migration of pending) {
    await execute(config, renderSql(migration, config.database))
    await recordApplied(config, migration)
    options.onApply?.(migration)
    applied.push(migration)
  }

  return { applied, report }
}

async function recordApplied(config: ClickHouseConfig, migration: Migration): Promise<void> {
  const row = JSON.stringify({
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
  })
  await execute(
    config,
    `INSERT INTO ${config.database}.${MIGRATIONS_TABLE} (version, name, checksum) FORMAT JSONEachRow ${row}`,
  )
}

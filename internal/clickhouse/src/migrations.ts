import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/
export const DATABASE_PLACEHOLDER = '{{database}}'

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export type Migration = {
  version: number
  name: string
  fileName: string
  sql: string
  checksum: string
}

export class MigrationFileError extends Error {
  constructor(fileName: string, reason: string) {
    super(`Migration ${fileName} is invalid: ${reason}`)
    this.name = 'MigrationFileError'
  }
}

export class MigrationSetError extends Error {
  constructor(reason: string) {
    super(`Migration set is invalid: ${reason}`)
    this.name = 'MigrationSetError'
  }
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(normalise(sql), 'utf8').digest('hex')
}

function normalise(sql: string): string {
  return sql.replace(/\r\n/g, '\n')
}

export function stripSqlNoise(sql: string): string {
  let result = ''
  let index = 0

  while (index < sql.length) {
    const rest = sql.slice(index)

    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end
      continue
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2)
      index = end === -1 ? sql.length : end + 2
      continue
    }

    const char = sql[index] as string
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(sql, index, char)
      continue
    }

    result += char
    index += 1
  }

  return result
}

function skipQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1
  while (index < sql.length) {
    const char = sql[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      if (sql[index + 1] === quote) {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return sql.length
}

export function countStatements(sql: string): number {
  return stripSqlNoise(sql)
    .split(';')
    .filter((statement) => statement.trim() !== '').length
}

export function parseMigrationFile(fileName: string, contents: string): Migration {
  const match = MIGRATION_FILE_PATTERN.exec(fileName)
  if (!match) {
    throw new MigrationFileError(
      fileName,
      'the name must be four digits, an underscore, and a lower_snake_case name, like 0004_add_issue_id.sql',
    )
  }

  const sql = normalise(contents).trim()
  if (sql === '') {
    throw new MigrationFileError(fileName, 'it is empty')
  }

  const statements = countStatements(sql)
  if (statements !== 1) {
    throw new MigrationFileError(
      fileName,
      `it holds ${statements} SQL statements; ClickHouse's HTTP API runs one per request, so split it into separate files`,
    )
  }

  return {
    version: Number(match[1]),
    name: match[2] as string,
    fileName,
    sql,
    checksum: checksumOf(sql),
  }
}

export function assertContiguous(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expected = index + 1
    if (migration.version !== expected) {
      throw new MigrationSetError(
        `expected version ${expected} after ${index} earlier migrations but found ${migration.version} (${migration.fileName}); versions start at 1 and never skip or repeat`,
      )
    }
  })
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const fileNames = readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()

  const migrations = fileNames.map((fileName) =>
    parseMigrationFile(fileName, readFileSync(join(dir, fileName), 'utf8')),
  )

  migrations.sort((left, right) => left.version - right.version)
  assertContiguous(migrations)
  return migrations
}

export function renderSql(migration: Migration, database: string): string {
  return migration.sql.split(DATABASE_PLACEHOLDER).join(database)
}

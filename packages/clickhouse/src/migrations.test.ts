import { describe, expect, it } from 'vitest'
import {
  assertContiguous,
  checksumOf,
  countStatements,
  DATABASE_PLACEHOLDER,
  loadMigrations,
  MigrationFileError,
  MigrationSetError,
  parseMigrationFile,
  renderSql,
  stripSqlNoise,
} from './migrations.ts'

const migration = (version: number, name: string) =>
  parseMigrationFile(`${String(version).padStart(4, '0')}_${name}.sql`, 'SELECT 1')

describe('parseMigrationFile', () => {
  it('reads the version and the name out of the file name', () => {
    const parsed = parseMigrationFile('0004_add_issue_id.sql', 'ALTER TABLE t ADD COLUMN c String')

    expect(parsed.version).toBe(4)
    expect(parsed.name).toBe('add_issue_id')
    expect(parsed.fileName).toBe('0004_add_issue_id.sql')
  })

  it.each([
    '4_add_issue_id.sql',
    '00004_add_issue_id.sql',
    '0004-add-issue-id.sql',
    '0004_AddIssueId.sql',
    '0004_add__issue.sql',
    '0004_.sql',
    'add_issue_id.sql',
  ])('rejects the file name %s', (fileName) => {
    expect(() => parseMigrationFile(fileName, 'SELECT 1')).toThrow(MigrationFileError)
  })

  it('rejects an empty file', () => {
    expect(() => parseMigrationFile('0001_empty.sql', '   \n  ')).toThrow(/it is empty/)
  })

  it('rejects a file holding more than one statement', () => {
    expect(() =>
      parseMigrationFile('0001_two.sql', 'CREATE TABLE a (x UInt8) ENGINE = Memory;\nDROP TABLE a'),
    ).toThrow(/2 SQL statements/)
  })

  it('accepts a single statement that ends with a semicolon', () => {
    expect(() => parseMigrationFile('0001_one.sql', 'SELECT 1;')).not.toThrow()
  })

  it('does not count a semicolon inside a string literal as a separator', () => {
    expect(() =>
      parseMigrationFile('0001_literal.sql', "ALTER TABLE t MODIFY COMMENT 'a; b'"),
    ).not.toThrow()
  })

  it('trims surrounding whitespace before hashing', () => {
    expect(parseMigrationFile('0001_a.sql', '\n SELECT 1 \n').checksum).toBe(
      parseMigrationFile('0001_a.sql', 'SELECT 1').checksum,
    )
  })
})

describe('checksumOf', () => {
  it('is stable across line endings', () => {
    expect(checksumOf('SELECT 1\nSELECT 2')).toBe(checksumOf('SELECT 1\r\nSELECT 2'))
  })

  it('changes when a single character changes', () => {
    expect(checksumOf('SELECT 1')).not.toBe(checksumOf('SELECT 2'))
  })
})

describe('stripSqlNoise', () => {
  it('drops line comments', () => {
    expect(stripSqlNoise('SELECT 1 -- ; not a statement\n')).toBe('SELECT 1 \n')
  })

  it('drops block comments', () => {
    expect(stripSqlNoise('SELECT /* ; */ 1')).toBe('SELECT  1')
  })

  it('drops quoted strings', () => {
    expect(stripSqlNoise("SELECT 'a;b'")).toBe('SELECT ')
  })

  it('keeps an escaped quote inside a string', () => {
    expect(countStatements("SELECT 'it\\'s; fine'")).toBe(1)
  })

  it('keeps a doubled quote inside a string', () => {
    expect(countStatements("SELECT 'it''s; fine'")).toBe(1)
  })

  it('does not run off the end of an unterminated string', () => {
    expect(countStatements("SELECT 'unterminated")).toBe(1)
  })
})

describe('assertContiguous', () => {
  it('accepts versions starting at one with no gaps', () => {
    expect(() => assertContiguous([migration(1, 'a'), migration(2, 'b')])).not.toThrow()
  })

  it('rejects a gap left by a deleted file', () => {
    expect(() => assertContiguous([migration(1, 'a'), migration(3, 'c')])).toThrow(
      MigrationSetError,
    )
  })

  it('rejects a set that does not start at one', () => {
    expect(() => assertContiguous([migration(2, 'b')])).toThrow(MigrationSetError)
  })

  it('rejects a repeated version', () => {
    expect(() => assertContiguous([migration(1, 'a'), migration(1, 'b')])).toThrow(
      MigrationSetError,
    )
  })
})

describe('renderSql', () => {
  it('replaces every occurrence of the database placeholder', () => {
    const parsed = parseMigrationFile(
      '0001_mv.sql',
      `CREATE MATERIALIZED VIEW ${DATABASE_PLACEHOLDER}.mv TO ${DATABASE_PLACEHOLDER}.t AS SELECT 1`,
    )

    expect(renderSql(parsed, 'nekolog_qa')).toBe(
      'CREATE MATERIALIZED VIEW nekolog_qa.mv TO nekolog_qa.t AS SELECT 1',
    )
  })

  it('leaves the checksum untouched, since it is taken before substitution', () => {
    const parsed = parseMigrationFile('0001_t.sql', `SELECT 1 FROM ${DATABASE_PLACEHOLDER}.t`)

    expect(parsed.checksum).toBe(checksumOf(`SELECT 1 FROM ${DATABASE_PLACEHOLDER}.t`))
  })
})

describe('the migrations shipped in this package', () => {
  const shipped = loadMigrations()

  it('loads without a format or ordering error', () => {
    expect(shipped.length).toBeGreaterThan(0)
  })

  it('creates the logs table first', () => {
    expect(shipped[0]?.fileName).toBe('0001_create_logs.sql')
  })

  it('qualifies every table with the database placeholder', () => {
    for (const entry of shipped) {
      expect(entry.sql).toContain(DATABASE_PLACEHOLDER)
    }
  })

  it('never hard-codes an environment database name', () => {
    for (const entry of shipped) {
      expect(entry.sql).not.toMatch(/nekolog_(dev|qa|prod)/)
    }
  })
})

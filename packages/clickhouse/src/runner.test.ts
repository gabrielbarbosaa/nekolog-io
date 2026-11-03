import { describe, expect, it } from 'vitest'
import { type Migration, parseMigrationFile } from './migrations.ts'
import { assertDatabaseName, assertNoDrift, buildStatus, MigrationStateError } from './runner.ts'

const migration = (version: number, name: string, sql = 'SELECT 1'): Migration =>
  parseMigrationFile(`${String(version).padStart(4, '0')}_${name}.sql`, sql)

const appliedRow = (entry: Migration, overrides: { checksum?: string } = {}) => ({
  version: entry.version,
  name: entry.name,
  checksum: overrides.checksum ?? entry.checksum,
  applied_at: '2026-10-30 12:00:00',
})

describe('assertDatabaseName', () => {
  it.each(['nekolog_dev', 'nekolog_prod', '_scratch'])('accepts %s', (name) => {
    expect(() => assertDatabaseName(name)).not.toThrow()
  })

  it.each(['nekolog dev', 'nekolog-dev', '1nekolog', 'a; DROP DATABASE b', ''])(
    'rejects %s',
    (name) => {
      expect(() => assertDatabaseName(name)).toThrow(MigrationStateError)
    },
  )
})

describe('buildStatus', () => {
  const first = migration(1, 'create_logs')
  const second = migration(2, 'create_rollup', 'SELECT 2')

  it('marks a migration with no row as pending', () => {
    const report = buildStatus('nekolog_dev', [first, second], [appliedRow(first)])

    expect(report.entries.map((entry) => entry.state)).toEqual(['applied', 'pending'])
  })

  it('carries the applied timestamp through', () => {
    const report = buildStatus('nekolog_dev', [first], [appliedRow(first)])

    expect(report.entries[0]?.appliedAt).toBe('2026-10-30 12:00:00')
  })

  it('marks a migration whose file changed after it ran as drifted', () => {
    const report = buildStatus(
      'nekolog_dev',
      [first],
      [appliedRow(first, { checksum: 'something-else' })],
    )

    expect(report.entries[0]?.state).toBe('drifted')
  })

  it('reports a row with no file as an orphan', () => {
    const report = buildStatus('nekolog_dev', [first], [appliedRow(first), appliedRow(second)])

    expect(report.orphans.map((row) => row.version)).toEqual([2])
  })
})

describe('assertNoDrift', () => {
  const first = migration(1, 'create_logs')
  const second = migration(2, 'create_rollup', 'SELECT 2')

  it('passes when everything applied matches its file', () => {
    expect(() =>
      assertNoDrift(buildStatus('nekolog_dev', [first, second], [appliedRow(first)])),
    ).not.toThrow()
  })

  it('stops on an edited migration and names the file', () => {
    const report = buildStatus(
      'nekolog_dev',
      [first],
      [appliedRow(first, { checksum: 'something-else' })],
    )

    expect(() => assertNoDrift(report)).toThrow(/0001_create_logs\.sql/)
  })

  it('stops on a deleted migration that the database still remembers', () => {
    const report = buildStatus('nekolog_dev', [first], [appliedRow(first), appliedRow(second)])

    expect(() => assertNoDrift(report)).toThrow(/missing from the migrations directory/)
  })

  it('stops when an earlier migration is pending but a later one already ran', () => {
    const report = buildStatus('nekolog_dev', [first, second], [appliedRow(second)])

    expect(() => assertNoDrift(report)).toThrow(/out of order/)
  })
})

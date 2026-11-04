import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(PACKAGE, 'migrations')

const DIALECT = 'postgresql'
const SCHEMA = './src/index.ts'
const DRIFT = '.drift'

function sqlFilesIn(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
}

function declaredNamesIn(source: string): string[] {
  const named = /\b(?:check|uniqueIndex|index)\('([a-z0-9_]+)'|\bname: '([a-z0-9_]+)'/g
  return [...source.matchAll(named)].map((match) => match[1] ?? match[2] ?? '').sort()
}

function countOf(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

const schemaSource = readFileSync(join(PACKAGE, 'src', 'index.ts'), 'utf8')
const migrationSql = sqlFilesIn(MIGRATIONS)
  .map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))
  .join('\n')

let regenerated: string

beforeAll(() => {
  regenerated = join(PACKAGE, DRIFT)
  rmSync(regenerated, { recursive: true, force: true })
  cpSync(MIGRATIONS, regenerated, { recursive: true })

  execFileSync(
    'pnpm',
    [
      'exec',
      'drizzle-kit',
      'generate',
      '--dialect',
      DIALECT,
      '--schema',
      SCHEMA,
      '--out',
      DRIFT,
      '--name',
      'drift_check',
    ],
    { cwd: PACKAGE, stdio: 'pipe', shell: true },
  )
}, 180_000)

afterAll(() => {
  rmSync(join(PACKAGE, DRIFT), { recursive: true, force: true })
})

describe('the migrations this package ships', () => {
  it('already say everything drizzle-kit would say about the schema', () => {
    expect(existsSync(regenerated), 'drizzle-kit wrote nothing, so this guard proves nothing').toBe(
      true,
    )

    expect(
      sqlFilesIn(regenerated),
      'drizzle-kit wrote a new migration, so src/index.ts changed without `pnpm db:generate`',
    ).toEqual(sqlFilesIn(MIGRATIONS))
  })

  it('carry every constraint and index the schema declares, by name', () => {
    const missing = declaredNamesIn(schemaSource).filter((name) => !migrationSql.includes(name))

    expect(missing, 'these are in src/index.ts but not in the SQL that actually runs').toEqual([])
  })

  it('cascade and null out exactly as often as the schema asks', () => {
    const asked = (action: string) =>
      countOf(schemaSource, new RegExp(`onDelete: '${action}'|\\.onDelete\\('${action}'\\)`, 'g'))

    expect(countOf(migrationSql, /ON DELETE cascade/g)).toBe(asked('cascade'))
    expect(countOf(migrationSql, /ON DELETE set null/g)).toBe(asked('set null'))
  })

  it('were generated with the dialect and schema the config names', () => {
    const config = readFileSync(join(PACKAGE, 'drizzle.config.ts'), 'utf8')

    expect(config).toContain(`dialect: '${DIALECT}'`)
    expect(config).toContain(`schema: '${SCHEMA}'`)
  })

  it('keep a journal that drizzle-kit can still parse', () => {
    const journal = readFileSync(join(MIGRATIONS, 'meta', '_journal.json'))

    expect(
      journal.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
      'the journal starts with a UTF-8 BOM, which makes `pnpm db:generate` die on JSON.parse',
    ).toBe(false)

    expect(() => JSON.parse(journal.toString('utf8'))).not.toThrow()
  })

  it('are numbered without a gap, so none was deleted by hand', () => {
    const versions =
      migrationSql === '' ? [] : sqlFilesIn(MIGRATIONS).map((f) => Number(f.slice(0, 4)))

    expect(versions).toEqual(versions.map((_, position) => position))
  })
})

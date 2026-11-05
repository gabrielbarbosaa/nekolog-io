import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type IssueOccurrence, sqlIssueStore } from '@nekolog-io/adapters'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type SeedDocument, toDocument } from './document.ts'
import { buildSeed } from './model.ts'
import { seedStatements } from './postgres.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const URL = process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'
const DATABASE = `nekolog_seed_${process.pid}`

async function answers(): Promise<boolean> {
  const admin = postgres(URL, { max: 1, idle_timeout: 1, connect_timeout: 3, onnotice: () => {} })
  try {
    await admin`select 1`
    return true
  } catch {
    return false
  } finally {
    await admin.end({ timeout: 1 })
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.POSTGRES_TEST_REQUIRED === '1') {
    throw new Error(
      `POSTGRES_TEST_REQUIRED is set but nothing answered at ${URL}. ` +
        'These tests must not be skipped here.',
    )
  }
  process.stderr.write(
    `\nSkipping the seed-to-Postgres integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

function migrationStatements(): string[] {
  const directory = join(ROOT, 'packages', 'db', 'migrations')
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(directory, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

let sql: postgres.Sql
let document: SeedDocument

beforeAll(async () => {
  if (!reachable) {
    return
  }
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`create database "${DATABASE}"`)
  } finally {
    await admin.end({ timeout: 5 })
  }

  sql = postgres(URL.replace(/\/[^/]*$/, `/${DATABASE}`), { max: 1, onnotice: () => {} })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }

  document = toDocument(
    await buildSeed({
      organization: 'NekoLog',
      project: 'nekolog',
      environments: ['production', 'staging'],
      retentionDays: 14,
    }),
  )
}, 120_000)

afterAll(async () => {
  if (!reachable) {
    return
  }
  await sql?.end({ timeout: 5 })
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`)
  } finally {
    await admin.end({ timeout: 5 })
  }
}, 120_000)

async function apply(): Promise<void> {
  for (const statement of seedStatements(document)) {
    await sql.unsafe(statement.text, statement.params as never[])
  }
}

describe.skipIf(!reachable)('a seed written into a real Postgres', () => {
  it('lands as one organization, one project, two environments and four keys', async () => {
    await apply()

    const [organizations] = await sql`select count(*)::int as n from organizations`
    const [projects] = await sql`select count(*)::int as n from projects`
    const [environments] = await sql`select count(*)::int as n from environments`
    const [keys] = await sql`select count(*)::int as n from api_keys`

    expect(organizations?.n).toBe(1)
    expect(projects?.n).toBe(1)
    expect(environments?.n).toBe(2)
    expect(keys?.n).toBe(4)
  })

  it('survives being applied again, which is what every container restart does', async () => {
    await apply()
    await apply()

    const [environments] = await sql`select count(*)::int as n from environments`
    const [keys] = await sql`select count(*)::int as n from api_keys`

    expect(environments?.n).toBe(2)
    expect(keys?.n).toBe(4)
  })

  it('carries the retention the seed chose, not the column default', async () => {
    await apply()
    const rows = await sql`select retention_days from environments order by name`

    expect(rows.map((row) => row.retention_days)).toEqual([14, 14])
  })

  it('lands the redaction as a jsonb object, not as a jsonb string of one', async () => {
    await apply()
    const rows = await sql`
      select min_level, sample_rate, redaction_rules, jsonb_typeof(redaction_rules) as shape
      from environments order by name`

    for (const row of rows) {
      expect(row.shape).toBe('object')
      expect(row.min_level).toBe('trace')
      expect(Number(row.sample_rate)).toBe(1)
      expect(row.redaction_rules).toEqual(document.environments[0]?.redaction)
    }
  })

  it('changes a setting on a seed that already exists, which is what seed set is for', async () => {
    await apply()
    const changed: SeedDocument = {
      ...document,
      environments: document.environments.map((environment) => ({
        ...environment,
        minLevel: 'warn',
        sampleRate: 0.25,
        redaction: { attributes: ['card.*'], patterns: ['cpf'], replacement: '[redacted]' },
      })),
    }
    for (const statement of seedStatements(changed)) {
      await sql.unsafe(statement.text, statement.params as never[])
    }

    const rows = await sql`select min_level, sample_rate, redaction_rules from environments`
    for (const row of rows) {
      expect(row.min_level).toBe('warn')
      expect(Number(row.sample_rate)).toBe(0.25)
      expect(row.redaction_rules).toEqual({
        attributes: ['card.*'],
        patterns: ['cpf'],
        replacement: '[redacted]',
      })
    }
  })

  it('satisfies the foreign key the issue rollup needs, which is why it exists', async () => {
    await apply()

    const environment = document.environments[0]
    const occurrence: IssueOccurrence = {
      projectId: document.project.id,
      environmentId: environment?.id as string,
      fingerprint: '18446744073709551615',
      events: 3,
      firstSeen: Date.UTC(2026, 10, 4, 12, 0, 0),
      lastSeen: Date.UTC(2026, 10, 4, 12, 5, 0),
      level: 'error',
      errorType: 'TypeError',
      title: 'TypeError: cannot read id',
      service: 'checkout',
      release: '',
    }

    const rollup = await sqlIssueStore(async (text, params) =>
      sql.unsafe(text, params as never[]),
    ).record([occurrence])

    expect(rollup.created + rollup.updated).toBe(1)
  })

  it('stores a hash of every key and no key, which is the whole point of the hash', async () => {
    await apply()
    const rows = await sql`select hash, hint from api_keys`

    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(String(row.hash)).toMatch(/^[0-9a-f]{64}$/)
      expect(String(row.hint)).toContain('…')
    }
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type IssueOccurrence, type SqlRunner, sqlIssueStore } from '@nekolog-io/adapters'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

const URL = process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'
const DATABASE = `nekolog_issues_${process.pid}`

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
    `\nSkipping the issue store integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

function migrationStatements(): string[] {
  const directory = join(PACKAGE, 'migrations')
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(directory, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let counter = 0

function id(prefix: string): string {
  counter += 1
  let suffix = ''
  for (let position = 0; position < 26; position += 1) {
    suffix += CROCKFORD[(counter * 11 + position * 7) % 32]
  }
  return `${prefix}${suffix}`
}

let sql: postgres.Sql
let run: SqlRunner
let projectId: string
let production: string
let staging: string

const AT = Date.UTC(2026, 10, 3, 12, 0, 0)

function occurrence(overrides: Partial<IssueOccurrence> = {}): IssueOccurrence {
  return {
    projectId,
    environmentId: production,
    fingerprint: '12345678901234567890',
    events: 3,
    firstSeen: AT,
    lastSeen: AT + 1000,
    level: 'error',
    errorType: 'TypeError',
    title: 'Cannot read properties of undefined',
    service: 'checkout-api',
    release: '1.4.2',
    ...overrides,
  }
}

async function issueRow(): Promise<Record<string, unknown> | undefined> {
  const rows = await sql`select * from issues where project_id = ${projectId}`
  return rows[0]
}

beforeAll(async () => {
  if (!reachable) {
    return
  }

  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`create database "${DATABASE}"`)
  } finally {
    await admin.end()
  }

  sql = postgres(URL.replace(/\/[^/]*$/, `/${DATABASE}`), { max: 1, onnotice: () => {} })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }

  run = async (text, params) => sql.unsafe(text, params as never[])

  const organizationId = id('org_')
  projectId = id('prj_')
  production = id('env_')
  staging = id('env_')

  await sql`insert into organizations ${sql({ id: organizationId, name: 'Acme' })}`
  await sql`insert into projects ${sql({ id: projectId, organization_id: organizationId, name: 'web' })}`
  await sql`insert into environments ${sql({ id: production, project_id: projectId, name: 'production' })}`
  await sql`insert into environments ${sql({ id: staging, project_id: projectId, name: 'staging' })}`
}, 60_000)

afterAll(async () => {
  await sql?.end()
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`)
  } finally {
    await admin.end()
  }
})

async function clear(): Promise<void> {
  await sql`delete from issues where project_id = ${projectId}`
}

describe.skipIf(!reachable)('the SQL issue store against a real Postgres', () => {
  it('opens an issue the first time, and adds to it after that', async () => {
    await clear()
    const store = sqlIssueStore(run)

    expect(await store.record([occurrence()])).toEqual({ created: 1, updated: 0, reopened: 0 })
    expect(await store.record([occurrence({ events: 2, lastSeen: AT + 9000 })])).toEqual({
      created: 0,
      updated: 1,
      reopened: 0,
    })

    const row = await issueRow()
    expect(Number(row?.events)).toBe(5)
    expect(new Date(row?.first_seen_at as string).getTime()).toBe(AT)
    expect(new Date(row?.last_seen_at as string).getTime()).toBe(AT + 9000)
    expect(row?.status).toBe('open')
  })

  it('never moves first seen forward, whichever order the occurrences arrive in', async () => {
    await clear()
    const store = sqlIssueStore(run)

    await store.record([occurrence({ firstSeen: AT, lastSeen: AT + 9000 })])
    await store.record([occurrence({ firstSeen: AT - 9000, lastSeen: AT })])

    const older = await issueRow()
    expect(new Date(older?.first_seen_at as string).getTime()).toBe(AT - 9000)
    expect(new Date(older?.last_seen_at as string).getTime()).toBe(AT + 9000)

    await clear()
    await store.record([occurrence({ firstSeen: AT - 9000, lastSeen: AT })])
    await store.record([occurrence({ firstSeen: AT, lastSeen: AT + 9000 })])

    const newer = await issueRow()
    expect(new Date(newer?.first_seen_at as string).getTime()).toBe(AT - 9000)
    expect(new Date(newer?.last_seen_at as string).getTime()).toBe(AT + 9000)
  })

  it('counts each environment on its own row', async () => {
    await clear()
    const store = sqlIssueStore(run)

    await store.record([occurrence({ events: 3 })])
    await store.record([occurrence({ environmentId: staging, events: 7 })])

    const row = await issueRow()
    const counts = await sql`
      select environment_id, events from issue_environments where issue_id = ${row?.id as string}
      order by events
    `

    expect(Number(row?.events)).toBe(10)
    expect(counts.map((one) => Number(one.events))).toEqual([3, 7])
  })

  it('reopens an issue that happened again after it was resolved', async () => {
    await clear()
    const store = sqlIssueStore(run)
    await store.record([occurrence()])
    await sql`update issues set status = 'resolved', resolved_at = ${new Date(AT + 2000)} where project_id = ${projectId}`

    const rollup = await store.record([occurrence({ lastSeen: AT + 5000 })])

    const row = await issueRow()
    expect(rollup.reopened).toBe(1)
    expect(row?.status).toBe('open')
    expect(new Date(row?.regressed_at as string).getTime()).toBe(AT + 5000)
  })

  it('leaves a resolved issue alone when the occurrence is older than the fix', async () => {
    await clear()
    const store = sqlIssueStore(run)
    await store.record([occurrence()])
    await sql`update issues set status = 'resolved', resolved_at = ${new Date(AT + 60_000)} where project_id = ${projectId}`

    const rollup = await store.record([occurrence({ lastSeen: AT + 5000 })])

    expect(rollup.reopened).toBe(0)
    expect((await issueRow())?.status).toBe('resolved')
  })

  it('never reopens one somebody chose to ignore', async () => {
    await clear()
    const store = sqlIssueStore(run)
    await store.record([occurrence()])
    await sql`update issues set status = 'ignored' where project_id = ${projectId}`

    const rollup = await store.record([occurrence({ lastSeen: AT + 999_000 })])

    expect(rollup.reopened).toBe(0)
    expect((await issueRow())?.status).toBe('ignored')
  })

  it('takes a title that is a SQL injection as a title', async () => {
    await clear()
    const store = sqlIssueStore(run)

    await store.record([occurrence({ title: "'; drop table issues; --" })])

    const row = await issueRow()
    expect(row?.title).toBe("'; drop table issues; --")

    const tables = await sql`select to_regclass('public.issues') as there`
    expect(tables[0]?.there).toBe('issues')
  })

  it('keeps a fingerprint that fills a UInt64', async () => {
    await clear()
    const store = sqlIssueStore(run)

    await store.record([occurrence({ fingerprint: '18446744073709551615' })])

    expect((await issueRow())?.fingerprint).toBe('18446744073709551615')
  })
})

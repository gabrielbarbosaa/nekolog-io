import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO_EMAIL, findDemoAccount, justLooking } from './demo.ts'
import { actorIn, createOrganization } from './members.ts'
import { suspendOrganization, suspendUser } from './operator.ts'
import { MEMBERSHIP_ID_PREFIX, newId, USER_ID_PREFIX } from './signup.ts'
import type { SqlRunner } from './users.ts'

const URL = process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'

async function answers(): Promise<boolean> {
  const probe = postgres(URL, { max: 1, connect_timeout: 2, onnotice: () => {} })
  try {
    await probe.unsafe('select 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end({ timeout: 1 })
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.POSTGRES_TEST_REQUIRED === '1') {
    throw new Error(
      `POSTGRES_TEST_REQUIRED is set but nothing answered at ${URL}. These tests must not be skipped here.`,
    )
  }
  process.stderr.write(
    `\nSkipping the demo integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
)

const DATABASE = `nekolog_demo_${process.pid}`

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

let sql: ReturnType<typeof postgres>
let run: SqlRunner

async function anAccount(options: { demo?: boolean; email?: string } = {}): Promise<string> {
  const id = newId(USER_ID_PREFIX)
  await sql.unsafe(
    `insert into users (id, name, email, password_hash, email_verified_at, is_demo)
     values ($1, 'Somebody', $2, '$argon2id$v=19$m=19456,t=2,p=1$abc$def', now(), $3)`,
    [
      id,
      options.email ?? `person-${randomBytes(5).toString('hex')}@acme.test`,
      options.demo === true,
    ],
  )
  return id
}

async function aDemo(): Promise<{ userId: string; organizationId: string }> {
  const organizationId = newId('org_')
  await sql.unsafe('insert into organizations (id, name, is_demo) values ($1, $2, true)', [
    organizationId,
    'NekoLog Demo',
  ])

  const userId = await anAccount({ demo: true, email: DEMO_EMAIL })
  await sql.unsafe(
    "insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
    [newId(MEMBERSHIP_ID_PREFIX), organizationId, userId],
  )

  return { userId, organizationId }
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

  sql = postgres(URL.replace(/\/[^/]*$/, `/${DATABASE}`), { max: 2, onnotice: () => {} })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }

  run = async (text, params) =>
    (await sql.unsafe(text, params as never[])) as unknown as ReadonlyArray<Record<string, unknown>>
}, 60_000)

afterAll(async () => {
  if (!reachable) {
    return
  }

  await sql?.end()
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`)
  } finally {
    await admin.end()
  }
}, 60_000)

describe.runIf(reachable)('the demo account', () => {
  it('is nobody until one is made', async () => {
    expect(await findDemoAccount(run)).toBeUndefined()
  })

  it('is found with the organization it may look at', async () => {
    const made = await aDemo()
    const found = await findDemoAccount(run)

    expect(found?.userId).toBe(made.userId)
    expect(found?.organizationId).toBe(made.organizationId)
    expect(found?.email).toBe(DEMO_EMAIL)
  })

  it('is marked, and an ordinary account is not', async () => {
    const found = await findDemoAccount(run)

    expect(await justLooking(run, String(found?.userId))).toBe(true)
    expect(await justLooking(run, await anAccount())).toBe(false)
  })

  it('arrives at its organization as a viewer, and the gate can see it is the demo', async () => {
    const found = await findDemoAccount(run)
    const actor = await actorIn(run, String(found?.userId), String(found?.organizationId))

    expect(actor?.role).toBe('viewer')
    expect(actor?.justLooking, 'the gate reads this in the same statement as the role').toBe(true)
  })

  it('reports an ordinary member as not just looking', async () => {
    const owner = await anAccount()
    const organizationId = await createOrganization(run, { name: 'Acme', ownerUserId: owner })

    expect((await actorIn(run, owner, String(organizationId)))?.justLooking).toBe(false)
  })
})

describe.runIf(reachable)('what takes the demo off the air', () => {
  it('a suspended demo account is no longer offered', async () => {
    const found = await findDemoAccount(run)
    const userId = String(found?.userId)

    await suspendUser(run, userId, true)
    expect(await findDemoAccount(run)).toBeUndefined()

    await suspendUser(run, userId, false)
    expect((await findDemoAccount(run))?.userId).toBe(userId)
  })

  it('a suspended demo organization is no longer offered either', async () => {
    const found = await findDemoAccount(run)
    const organizationId = String(found?.organizationId)

    await suspendOrganization(run, organizationId, true)
    expect(await findDemoAccount(run)).toBeUndefined()

    await suspendOrganization(run, organizationId, false)
    expect((await findDemoAccount(run))?.organizationId).toBe(organizationId)
  })
})

describe.runIf(reachable)('what the schema refuses outright', () => {
  it('a demo account that is also an operator', async () => {
    const userId = await anAccount({ demo: true })

    await expect(
      sql.unsafe('update users set is_operator = true where id = $1', [userId]),
    ).rejects.toThrow(/users_a_demo_account_is_never_an_operator/)
  })

  it('and the other way round, so neither order slips through', async () => {
    const userId = await anAccount()
    await sql.unsafe('update users set is_operator = true where id = $1', [userId])

    await expect(
      sql.unsafe('update users set is_demo = true where id = $1', [userId]),
    ).rejects.toThrow(/users_a_demo_account_is_never_an_operator/)
  })
})

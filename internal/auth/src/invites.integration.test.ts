import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claimInvite, findOpenInvite, hashInviteToken, newInviteToken } from './invites.ts'
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
    `\nSkipping the invite integration tests: nothing answered at ${URL}.\n` +
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

const DATABASE = `nekolog_invites_${process.pid}`

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

function id(prefix: string): string {
  return newId(prefix)
}

async function anOrganization(): Promise<string> {
  const organizationId = id('org_')
  await sql.unsafe('insert into organizations (id, name) values ($1, $2)', [
    organizationId,
    'Invites',
  ])
  return organizationId
}

async function anAccount(email: string): Promise<string> {
  const userId = id(USER_ID_PREFIX)
  await sql.unsafe('insert into users (id, name, email, password_hash) values ($1, $2, $3, $4)', [
    userId,
    'Invited',
    email,
    '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
  ])
  return userId
}

async function anInvite(
  organizationId: string,
  email: string,
  overrides: { expiresIn?: string; revoked?: boolean; accepted?: boolean } = {},
): Promise<string> {
  const token = newInviteToken()
  const expired = overrides.expiresIn !== undefined && overrides.expiresIn.startsWith('-')

  await sql.unsafe(
    `insert into invites
       (id, organization_id, email, role, token_hash, created_at, expires_at, revoked_at, accepted_at)
     values ($1, $2, $3, 'member', $4, now() - $5::interval, now() + $6::interval, $7, $8)`,
    [
      id('inv_'),
      organizationId,
      email,
      hashInviteToken(token),
      expired ? '30 days' : '0 seconds',
      overrides.expiresIn ?? '7 days',
      overrides.revoked === true ? new Date() : null,
      overrides.accepted === true ? new Date() : null,
    ],
  )
  return token
}

function address(): string {
  return `invite-${randomBytes(5).toString('hex')}@acme.test`
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
})

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
})

describe.skipIf(!reachable)('finding the invite behind a link', () => {
  it('finds an open one by the hash of the token, never by the token', async () => {
    const organizationId = await anOrganization()
    const email = address()
    const token = await anInvite(organizationId, email)

    const found = await findOpenInvite(run, token)
    expect(found?.email).toBe(email)
    expect(found?.organizationId).toBe(organizationId)
    expect(found?.role).toBe('member')
  })

  it('finds nothing for a token nobody issued', async () => {
    expect(await findOpenInvite(run, newInviteToken())).toBeUndefined()
    expect(await findOpenInvite(run, '')).toBeUndefined()
    expect(await findOpenInvite(run, '   ')).toBeUndefined()
  })

  it('finds nothing once the invite has expired', async () => {
    const organizationId = await anOrganization()
    const token = await anInvite(organizationId, address(), { expiresIn: '-1 second' })

    expect(await findOpenInvite(run, token)).toBeUndefined()
  })

  it('finds nothing once the invite was revoked', async () => {
    const organizationId = await anOrganization()
    const token = await anInvite(organizationId, address(), { revoked: true })

    expect(await findOpenInvite(run, token)).toBeUndefined()
  })

  it('finds nothing once the invite was already accepted', async () => {
    const organizationId = await anOrganization()
    const token = await anInvite(organizationId, address(), { accepted: true })

    expect(await findOpenInvite(run, token)).toBeUndefined()
  })
})

describe.skipIf(!reachable)('claiming it', () => {
  it('confirms the account, spends the invite and creates the membership at once', async () => {
    const organizationId = await anOrganization()
    const email = address()
    await anInvite(organizationId, email)
    const userId = await anAccount(email)

    const claimed = await claimInvite(run, userId, id(MEMBERSHIP_ID_PREFIX))
    expect(claimed?.joined).toBe(organizationId)

    const [account] = await sql.unsafe('select email_verified_at from users where id = $1', [
      userId,
    ])
    const [membership] = await sql.unsafe(
      'select role from memberships where user_id = $1 and organization_id = $2',
      [userId, organizationId],
    )
    const [invite] = await sql.unsafe(
      'select accepted_at from invites where organization_id = $1',
      [organizationId],
    )

    expect(account?.email_verified_at).not.toBeNull()
    expect(membership?.role).toBe('member')
    expect(invite?.accepted_at).not.toBeNull()
  })

  it('does nothing a second time, and leaves one membership', async () => {
    const organizationId = await anOrganization()
    const email = address()
    await anInvite(organizationId, email)
    const userId = await anAccount(email)

    await claimInvite(run, userId, id(MEMBERSHIP_ID_PREFIX))
    expect(await claimInvite(run, userId, id(MEMBERSHIP_ID_PREFIX))).toBeUndefined()

    const rows = await sql.unsafe('select id from memberships where user_id = $1', [userId])
    expect(rows).toHaveLength(1)
  })

  it('refuses to claim an expired invite, and leaves the account unconfirmed', async () => {
    const organizationId = await anOrganization()
    const email = address()
    await anInvite(organizationId, email, { expiresIn: '-1 second' })
    const userId = await anAccount(email)

    expect(await claimInvite(run, userId, id(MEMBERSHIP_ID_PREFIX))).toBeUndefined()

    const rows = await sql.unsafe('select id from memberships where user_id = $1', [userId])
    expect(rows).toHaveLength(0)
  })

  it('refuses to claim a revoked invite', async () => {
    const organizationId = await anOrganization()
    const email = address()
    await anInvite(organizationId, email, { revoked: true })
    const userId = await anAccount(email)

    expect(await claimInvite(run, userId, id(MEMBERSHIP_ID_PREFIX))).toBeUndefined()
  })

  it('never claims an invite addressed to somebody else', async () => {
    const organizationId = await anOrganization()
    await anInvite(organizationId, address())
    const userId = await anAccount(address())

    expect(await claimInvite(run, userId, id(MEMBERSHIP_ID_PREFIX))).toBeUndefined()
  })
})

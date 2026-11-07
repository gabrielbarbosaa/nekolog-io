import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE_KEYS } from '@nekolog-io/adapters'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claimInvite } from './invites.ts'
import { createOrganization } from './members.ts'
import {
  isOperator,
  listAccounts,
  listOrganizations,
  setQuota,
  startAnOrganization,
  suspendOrganization,
  suspendUser,
} from './operator.ts'
import {
  createProject,
  listEnvironments,
  readEnvironmentSettings,
  updateEnvironment,
} from './projects.ts'
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
    `\nSkipping the operator integration tests: nothing answered at ${URL}.\n` +
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

const DATABASE = `nekolog_operator_${process.pid}`

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

async function anAccount(operator = false): Promise<string> {
  const id = newId(USER_ID_PREFIX)
  await sql.unsafe(
    `insert into users (id, name, email, password_hash, email_verified_at, is_operator)
     values ($1, $2, $3, '$argon2id$v=19$m=19456,t=2,p=1$abc$def', now(), $4)`,
    [id, 'Somebody', `person-${randomBytes(5).toString('hex')}@acme.test`, operator],
  )
  return id
}

async function anOrganization(): Promise<string> {
  const id = await createOrganization(run, {
    name: `Acme ${randomBytes(3).toString('hex')}`,
    ownerUserId: await anAccount(),
  })
  if (id === undefined) {
    throw new Error('the organization was not created')
  }
  return id
}

async function aKeyIn(organizationId: string): Promise<string> {
  const project = await createProject(run, { organizationId, name: 'The Shop' })
  if (project.outcome !== 'created') {
    throw new Error('no project')
  }
  const environment = (await listEnvironments(run, organizationId, project.projectId))[0]
  if (environment === undefined) {
    throw new Error('no environment')
  }

  const keyId = newId('key_')
  await sql.unsafe(
    `insert into api_keys (id, environment_id, kind, hash, hint, scopes)
     values ($1, $2, 'secret', $3, 'nekolog_sk_…abcd', '{"logs:write"}')`,
    [keyId, environment.id, randomBytes(32).toString('hex')],
  )
  return keyId
}

function sound(patch: Record<string, unknown> = {}) {
  const read = readEnvironmentSettings({
    retentionDays: 7,
    minLevel: 'trace',
    sampleRate: 1,
    ...patch,
  })
  if ('refused' in read) {
    throw new Error(`refused ${read.refused}`)
  }
  return read.settings
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

describe.runIf(reachable)('who the operator is', () => {
  it('is nobody by default, because the flag is a decision somebody took', async () => {
    expect(await isOperator(run, await anAccount())).toBe(false)
    expect(await isOperator(run, await anAccount(true))).toBe(true)
  })

  it('is not an operator for an account that is not there', async () => {
    expect(await isOperator(run, newId(USER_ID_PREFIX))).toBe(false)
  })
})

describe.runIf(reachable)('starting an organization from the operator area', () => {
  it('creates the organization and the invite in one statement', async () => {
    const operator = await anAccount(true)
    const started = await startAnOrganization(run, {
      name: 'A New Tenant',
      email: 'founder@acme.test',
      invitedBy: operator,
    })

    expect(started.outcome).toBe('started')
    if (started.outcome !== 'started') {
      return
    }

    const [invite] = await sql.unsafe('select role, organization_id from invites where id = $1', [
      started.inviteId,
    ])
    expect(invite?.organization_id).toBe(started.organizationId)
    expect(invite?.role, 'the schema refuses an invite that grants ownership').toBe('admin')
  })

  it('makes the person who accepts it the owner, since nobody else is', async () => {
    const started = await startAnOrganization(run, {
      name: 'Another Tenant',
      email: `founder-${randomBytes(4).toString('hex')}@acme.test`,
      invitedBy: await anAccount(true),
    })
    if (started.outcome !== 'started') {
      throw new Error(started.outcome)
    }

    const userId = newId(USER_ID_PREFIX)
    await sql.unsafe(
      `insert into users (id, name, email, password_hash)
       values ($1, 'Founder', $2, '$argon2id$v=19$m=19456,t=2,p=1$abc$def')`,
      [userId, started.email],
    )

    const claimed = await claimInvite(run, userId, newId(MEMBERSHIP_ID_PREFIX))

    expect(claimed?.joined).toBe(started.organizationId)
    expect(claimed?.role).toBe('owner')
  })

  it('leaves nothing behind when the name is no name at all', async () => {
    const before = (await listOrganizations(run)).length
    const started = await startAnOrganization(run, {
      name: '   ',
      email: 'founder@acme.test',
      invitedBy: await anAccount(true),
    })

    expect(started.outcome).toBe('bad-name')
    expect(await listOrganizations(run)).toHaveLength(before)
  })

  it('refuses an address that is not one', async () => {
    const started = await startAnOrganization(run, {
      name: 'Fine',
      email: 'not an address',
      invitedBy: await anAccount(true),
    })

    expect(started.outcome).toBe('bad-address')
  })
})

describe.runIf(reachable)('the quota the operator sets', () => {
  it('starts at what the plan promises', async () => {
    const organizationId = await anOrganization()
    const found = (await listOrganizations(run)).find((one) => one.id === organizationId)

    expect(found?.dailyEventQuota).toBe(10_000)
    expect(found?.maxRetentionDays).toBe(7)
  })

  it('binds what an administrator may then ask for', async () => {
    const organizationId = await anOrganization()
    const project = await createProject(run, { organizationId, name: 'The Shop' })
    if (project.outcome !== 'created') {
      throw new Error('no project')
    }
    const environment = (await listEnvironments(run, organizationId, project.projectId))[0]
    if (environment === undefined) {
      throw new Error('no environment')
    }

    const over = await updateEnvironment(run, {
      organizationId,
      projectId: project.projectId,
      environmentId: environment.id,
      settings: sound({ retentionDays: 30 }),
    })
    expect(over).toEqual({ outcome: 'over-the-cap', cap: 7 })

    await setQuota(run, organizationId, { dailyEventQuota: 50_000, maxRetentionDays: 30 })

    const within = await updateEnvironment(run, {
      organizationId,
      projectId: project.projectId,
      environmentId: environment.id,
      settings: sound({ retentionDays: 30 }),
    })
    expect(within.outcome).toBe('written')
  })

  it('pulls an environment back when the cap comes down under it', async () => {
    const organizationId = await anOrganization()
    await setQuota(run, organizationId, { dailyEventQuota: 50_000, maxRetentionDays: 30 })

    const project = await createProject(run, { organizationId, name: 'The Shop' })
    if (project.outcome !== 'created') {
      throw new Error('no project')
    }
    const environment = (await listEnvironments(run, organizationId, project.projectId))[0]
    if (environment === undefined) {
      throw new Error('no environment')
    }
    await updateEnvironment(run, {
      organizationId,
      projectId: project.projectId,
      environmentId: environment.id,
      settings: sound({ retentionDays: 30 }),
    })

    const lowered = await setQuota(run, organizationId, {
      dailyEventQuota: 1_000,
      maxRetentionDays: 3,
    })

    expect(lowered).toMatchObject({ outcome: 'set', environmentsHeldBack: 3 })

    const [row] = await sql.unsafe('select retention_days from environments where id = $1', [
      environment.id,
    ])
    expect(row?.retention_days, 'a cap nothing enforces is a cap nobody has').toBe(3)
  })

  it('refuses a quota that is not a quota', async () => {
    const organizationId = await anOrganization()

    for (const bad of [
      { dailyEventQuota: 0, maxRetentionDays: 7 },
      { dailyEventQuota: 1.5, maxRetentionDays: 7 },
      { dailyEventQuota: 1_000, maxRetentionDays: 0 },
      { dailyEventQuota: 1_000, maxRetentionDays: 400 },
      { dailyEventQuota: 'lots', maxRetentionDays: 7 },
    ]) {
      expect((await setQuota(run, organizationId, bad)).outcome, JSON.stringify(bad)).toBe(
        'bad-quota',
      )
    }
  })

  it('says so when the organization is not there', async () => {
    const answer = await setQuota(run, 'org_0000000000000000000000000', {
      dailyEventQuota: 1_000,
      maxRetentionDays: 7,
    })

    expect(answer.outcome).toBe('no-such-organization')
  })
})

describe.runIf(reachable)('suspending', () => {
  it('takes an organization off the air, and the keys go with it', async () => {
    const organizationId = await anOrganization()
    const keyId = await aKeyIn(organizationId)

    const before = await run(LIVE_KEYS, [])
    expect(before.map((row) => row.id)).toContain(keyId)

    expect(await suspendOrganization(run, organizationId, true)).toBe(true)

    const after = await run(LIVE_KEYS, [])
    expect(
      after.map((row) => row.id),
      'key-sync publishes this list, so a suspended tenant stops being ingested',
    ).not.toContain(keyId)
  })

  it('puts it back exactly as it was', async () => {
    const organizationId = await anOrganization()
    const keyId = await aKeyIn(organizationId)

    await suspendOrganization(run, organizationId, true)
    expect(await suspendOrganization(run, organizationId, false)).toBe(true)

    expect((await run(LIVE_KEYS, [])).map((row) => row.id)).toContain(keyId)
  })

  it('says so when there is no such organization', async () => {
    expect(await suspendOrganization(run, 'org_0000000000000000000000000', true)).toBe(false)
  })

  it('marks an account, which is what stops it holding a session', async () => {
    const userId = await anAccount()

    expect(await suspendUser(run, userId, true)).toBe(true)
    const [row] = await sql.unsafe('select suspended_at from users where id = $1', [userId])
    expect(row?.suspended_at).not.toBeNull()

    expect(await suspendUser(run, userId, false)).toBe(true)
    const [back] = await sql.unsafe('select suspended_at from users where id = $1', [userId])
    expect(back?.suspended_at).toBeNull()
  })
})

describe.runIf(reachable)('what the operator can look at', () => {
  it('counts the members and the projects of each organization', async () => {
    const organizationId = await anOrganization()
    await createProject(run, { organizationId, name: 'One' })
    await createProject(run, { organizationId, name: 'Two' })

    const found = (await listOrganizations(run)).find((one) => one.id === organizationId)

    expect(found?.members).toBe(1)
    expect(found?.projects).toBe(2)
  })

  it('finds an account by part of its address', async () => {
    const userId = await anAccount()
    const [row] = await sql.unsafe('select email from users where id = $1', [userId])
    const email = String(row?.email)

    const found = await listAccounts(run, email.slice(0, 12))

    expect(found.map((one) => one.id)).toContain(userId)
  })

  it('hands back no password hash, ever', async () => {
    await anAccount()
    const found = await listAccounts(run)

    expect(found.length).toBeGreaterThan(0)
    for (const account of found) {
      expect(Object.keys(account)).not.toContain('passwordHash')
    }
  })
})

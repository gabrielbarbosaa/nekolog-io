import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findOpenInvite } from './invites.ts'
import {
  changeRole,
  createOrganization,
  deleteOrganization,
  inviteMember,
  listAudit,
  listInvites,
  listMembers,
  organizationsOf,
  recordAudit,
  removeMember,
  renameOrganization,
  revokeInvite,
  roleIn,
  transferOwnership,
} from './members.ts'
import { newId, USER_ID_PREFIX } from './signup.ts'
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
    `\nSkipping the membership integration tests: nothing answered at ${URL}.\n` +
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

const DATABASE = `nekolog_members_${process.pid}`

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

async function aPerson(): Promise<{ id: string; email: string }> {
  const id = newId(USER_ID_PREFIX)
  const email = `member-${randomBytes(5).toString('hex')}@acme.test`
  await sql.unsafe(
    `insert into users (id, name, email, password_hash, email_verified_at)
     values ($1, $2, $3, '$argon2id$v=19$m=19456,t=2,p=1$abc$def', now())`,
    [id, 'A Person', email],
  )
  return { id, email }
}

async function anOrganization(ownerId: string): Promise<string> {
  const id = await createOrganization(run, {
    name: `Acme ${randomBytes(3).toString('hex')}`,
    ownerUserId: ownerId,
  })
  if (id === undefined) {
    throw new Error('the organization was not created')
  }
  return id
}

async function membershipOf(organizationId: string, userId: string): Promise<string> {
  const rows = await sql.unsafe(
    'select id from memberships where organization_id = $1 and user_id = $2',
    [organizationId, userId],
  )
  const row = rows[0] as { id?: string } | undefined
  if (row?.id === undefined) {
    throw new Error('no membership')
  }
  return row.id
}

async function joinOrganization(
  organizationId: string,
  userId: string,
  role: string,
): Promise<string> {
  const id = newId('mem_')
  await sql.unsafe(
    'insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, $4)',
    [id, organizationId, userId, role],
  )
  return id
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
})

describe.skipIf(!reachable)('creating an organization', () => {
  it('makes the person who created it its owner, in one statement', async () => {
    const person = await aPerson()
    const organizationId = await anOrganization(person.id)

    expect(await roleIn(run, person.id, organizationId)).toBe('owner')
    expect(await listMembers(run, organizationId)).toHaveLength(1)
  })

  it('refuses a name that is only whitespace, and writes nothing', async () => {
    const person = await aPerson()

    expect(await createOrganization(run, { name: '   ', ownerUserId: person.id })).toBeUndefined()
    expect(await organizationsOf(run, person.id)).toEqual([])
  })

  it('tidies the name the way the sign-up tidies a person’s', async () => {
    const person = await aPerson()
    const organizationId = await createOrganization(run, {
      name: '  Acme   Widgets  ',
      ownerUserId: person.id,
    })

    const [organization] = await organizationsOf(run, person.id)
    expect(organizationId).toBeDefined()
    expect(organization?.name).toBe('Acme Widgets')
  })

  it('lists only the organizations the person actually belongs to', async () => {
    const mine = await aPerson()
    const theirs = await aPerson()
    const ours = await anOrganization(mine.id)
    await anOrganization(theirs.id)

    expect((await organizationsOf(run, mine.id)).map((one) => one.id)).toEqual([ours])
  })
})

describe.skipIf(!reachable)('the role somebody holds, which is the whole gate', () => {
  it('is undefined for a person who is not a member, not an error', async () => {
    const owner = await aPerson()
    const stranger = await aPerson()
    const organizationId = await anOrganization(owner.id)

    expect(await roleIn(run, stranger.id, organizationId)).toBeUndefined()
  })

  it('is undefined for an organization that does not exist', async () => {
    const person = await aPerson()

    expect(await roleIn(run, person.id, 'org_0000000000000000000000000')).toBeUndefined()
  })

  it('is the role of this person here, never the one they hold elsewhere', async () => {
    const person = await aPerson()
    const other = await aPerson()
    const mine = await anOrganization(person.id)
    const theirs = await anOrganization(other.id)
    await joinOrganization(theirs, person.id, 'viewer')

    expect(await roleIn(run, person.id, mine)).toBe('owner')
    expect(await roleIn(run, person.id, theirs)).toBe('viewer')
  })
})

describe.skipIf(!reachable)('inviting somebody', () => {
  it('stores the hash of the token, and the link finds the invite', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)

    const invited = await inviteMember(run, {
      organizationId,
      email: 'Newcomer@Acme.Test',
      role: 'member',
      invitedBy: owner.id,
    })
    if (invited.outcome !== 'invited') {
      throw new Error(invited.outcome)
    }

    const found = await findOpenInvite(run, invited.token)
    expect(found?.organizationId).toBe(organizationId)
    expect(found?.email).toBe('newcomer@acme.test')

    const stored = await sql.unsafe('select token_hash from invites where id = $1', [
      invited.inviteId,
    ])
    expect(Object.values(stored[0] ?? {})).not.toContain(invited.token)
  })

  it('refuses to invite somebody who is already a member', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)

    expect(
      await inviteMember(run, {
        organizationId,
        email: owner.email,
        role: 'member',
        invitedBy: owner.id,
      }),
    ).toEqual({ outcome: 'already-a-member' })
  })

  it('refuses to invite anybody as owner, which the schema also refuses', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)

    expect(
      await inviteMember(run, {
        organizationId,
        email: 'someone@acme.test',
        role: 'owner',
        invitedBy: owner.id,
      }),
    ).toEqual({ outcome: 'bad-role' })
  })

  it('replaces an open invite rather than leaving two for one address', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)
    const email = `twice-${randomBytes(4).toString('hex')}@acme.test`

    const first = await inviteMember(run, {
      organizationId,
      email,
      role: 'viewer',
      invitedBy: owner.id,
    })
    const second = await inviteMember(run, {
      organizationId,
      email,
      role: 'admin',
      invitedBy: owner.id,
    })
    if (first.outcome !== 'invited' || second.outcome !== 'invited') {
      throw new Error('one of the invites was refused')
    }

    const open = await listInvites(run, organizationId)
    expect(open).toHaveLength(1)
    expect(open[0]?.role).toBe('admin')
    expect(
      await findOpenInvite(run, first.token),
      'the first link must stop working once it is replaced',
    ).toBeUndefined()
    expect(await findOpenInvite(run, second.token)).toBeDefined()
  })

  it('stops a revoked invite from being used or listed', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)
    const invited = await inviteMember(run, {
      organizationId,
      email: 'gone@acme.test',
      role: 'member',
      invitedBy: owner.id,
    })
    if (invited.outcome !== 'invited') {
      throw new Error(invited.outcome)
    }

    expect(await revokeInvite(run, organizationId, invited.inviteId)).toBe('gone@acme.test')
    expect(await listInvites(run, organizationId)).toEqual([])
    expect(await findOpenInvite(run, invited.token)).toBeUndefined()
    expect(
      await revokeInvite(run, organizationId, invited.inviteId),
      'revoking twice must not report a second success',
    ).toBeUndefined()
  })

  it('never revokes an invite belonging to another organization', async () => {
    const owner = await aPerson()
    const stranger = await aPerson()
    const mine = await anOrganization(owner.id)
    const theirs = await anOrganization(stranger.id)
    const invited = await inviteMember(run, {
      organizationId: theirs,
      email: 'theirs@acme.test',
      role: 'member',
      invitedBy: stranger.id,
    })
    if (invited.outcome !== 'invited') {
      throw new Error(invited.outcome)
    }

    expect(await revokeInvite(run, mine, invited.inviteId)).toBeUndefined()
    expect(await listInvites(run, theirs)).toHaveLength(1)
  })
})

describe.skipIf(!reachable)('the last owner', () => {
  it('cannot be demoted, so the organization is never left without one', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)
    const membershipId = await membershipOf(organizationId, owner.id)

    expect(await changeRole(run, organizationId, membershipId, 'admin')).toEqual({
      outcome: 'the-last-owner',
    })
    expect(await roleIn(run, owner.id, organizationId)).toBe('owner')
  })

  it('cannot be removed either', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)
    const membershipId = await membershipOf(organizationId, owner.id)

    expect(await removeMember(run, organizationId, membershipId)).toEqual({
      outcome: 'the-last-owner',
    })
    expect(await listMembers(run, organizationId)).toHaveLength(1)
  })

  it('can step down once somebody else owns it', async () => {
    const owner = await aPerson()
    const other = await aPerson()
    const organizationId = await anOrganization(owner.id)
    await joinOrganization(organizationId, other.id, 'admin')
    const theirMembership = await membershipOf(organizationId, other.id)
    const myMembership = await membershipOf(organizationId, owner.id)

    expect((await changeRole(run, organizationId, theirMembership, 'owner')).outcome).toBe(
      'changed',
    )
    expect((await changeRole(run, organizationId, myMembership, 'admin')).outcome).toBe('changed')
    expect(await roleIn(run, owner.id, organizationId)).toBe('admin')
    expect(await roleIn(run, other.id, organizationId)).toBe('owner')
  })

  it('hands the organization over in one statement, and keeps one owner throughout', async () => {
    const owner = await aPerson()
    const heir = await aPerson()
    const organizationId = await anOrganization(owner.id)
    await joinOrganization(organizationId, heir.id, 'member')

    expect(await transferOwnership(run, organizationId, heir.id, owner.id)).toBe(true)
    expect(await roleIn(run, heir.id, organizationId)).toBe('owner')
    expect(await roleIn(run, owner.id, organizationId)).toBe('admin')
  })

  it('refuses to hand it to somebody who is not a member, and changes nothing', async () => {
    const owner = await aPerson()
    const stranger = await aPerson()
    const organizationId = await anOrganization(owner.id)

    expect(await transferOwnership(run, organizationId, stranger.id, owner.id)).toBe(false)
    expect(await roleIn(run, owner.id, organizationId)).toBe('owner')
  })
})

describe.skipIf(!reachable)('changing and removing members across organizations', () => {
  it('never changes a membership of another organization', async () => {
    const owner = await aPerson()
    const stranger = await aPerson()
    const victim = await aPerson()
    const mine = await anOrganization(owner.id)
    const theirs = await anOrganization(stranger.id)
    const theirMembership = await joinOrganization(theirs, victim.id, 'member')

    expect(await changeRole(run, mine, theirMembership, 'admin')).toEqual({
      outcome: 'the-last-owner',
    })
    expect(await roleIn(run, victim.id, theirs)).toBe('member')
  })

  it('never removes a membership of another organization', async () => {
    const owner = await aPerson()
    const stranger = await aPerson()
    const victim = await aPerson()
    const mine = await anOrganization(owner.id)
    const theirs = await anOrganization(stranger.id)
    const theirMembership = await joinOrganization(theirs, victim.id, 'member')

    expect(await removeMember(run, mine, theirMembership)).toEqual({ outcome: 'the-last-owner' })
    expect(await roleIn(run, victim.id, theirs)).toBe('member')
  })

  it('removes a member of its own, and the person keeps their account', async () => {
    const owner = await aPerson()
    const leaving = await aPerson()
    const organizationId = await anOrganization(owner.id)
    const membershipId = await joinOrganization(organizationId, leaving.id, 'member')

    expect((await removeMember(run, organizationId, membershipId)).outcome).toBe('changed')
    expect(await roleIn(run, leaving.id, organizationId)).toBeUndefined()

    const left = await sql.unsafe('select id from users where id = $1', [leaving.id])
    expect(left).toHaveLength(1)
  })
})

describe.skipIf(!reachable)('the audit log', () => {
  it('records what happened, newest first, and never an address', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)

    await recordAudit(run, {
      organizationId,
      actorUserId: owner.id,
      action: 'member.invited',
      targetType: 'invite',
      targetId: 'inv_1',
      metadata: { role: 'member' },
      country: 'BR',
    })
    await recordAudit(run, {
      organizationId,
      actorUserId: owner.id,
      action: 'organization.renamed',
      targetType: 'organization',
      targetId: organizationId,
    })

    const entries = await listAudit(run, organizationId)
    expect(entries.map((entry) => entry.action)).toEqual(['organization.renamed', 'member.invited'])
    expect(entries[1]?.metadata).toEqual({ role: 'member' })
    expect(entries[1]?.country).toBe('BR')
    expect(entries[0]?.country).toBeUndefined()
  })

  it('writes no country at all when what it was given is not a country', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)

    await recordAudit(run, {
      organizationId,
      actorUserId: owner.id,
      action: 'member.removed',
      targetType: 'membership',
      country: '203.0.113.7',
    })

    expect((await listAudit(run, organizationId))[0]?.country).toBeUndefined()
  })

  it('shows only its own organization', async () => {
    const owner = await aPerson()
    const stranger = await aPerson()
    const mine = await anOrganization(owner.id)
    const theirs = await anOrganization(stranger.id)

    await recordAudit(run, {
      organizationId: theirs,
      actorUserId: stranger.id,
      action: 'organization.created',
      targetType: 'organization',
    })

    expect(await listAudit(run, mine)).toEqual([])
  })

  it('keeps the record when the person who did it is deleted', async () => {
    const owner = await aPerson()
    const actor = await aPerson()
    const organizationId = await anOrganization(owner.id)
    await recordAudit(run, {
      organizationId,
      actorUserId: actor.id,
      action: 'key.revoked',
      targetType: 'api_key',
    })

    await sql.unsafe('delete from users where id = $1', [actor.id])

    const entries = await listAudit(run, organizationId)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.actor).toBeUndefined()
  })
})

describe.skipIf(!reachable)('renaming and deleting', () => {
  it('renames only the organization it was given', async () => {
    const owner = await aPerson()
    const mine = await anOrganization(owner.id)
    const theirs = await anOrganization((await aPerson()).id)

    expect(await renameOrganization(run, mine, 'Renamed')).toBe('Renamed')
    const [listed] = await organizationsOf(run, owner.id)
    expect(listed?.name).toBe('Renamed')
    expect(await renameOrganization(run, theirs, '  ')).toBeUndefined()
  })

  it('takes the memberships and the audit with it when it goes', async () => {
    const owner = await aPerson()
    const organizationId = await anOrganization(owner.id)
    await recordAudit(run, {
      organizationId,
      actorUserId: owner.id,
      action: 'organization.created',
      targetType: 'organization',
    })

    expect(await deleteOrganization(run, organizationId)).toBe(true)
    expect(await roleIn(run, owner.id, organizationId)).toBeUndefined()
    expect(
      await sql.unsafe('select id from audit_log where organization_id = $1', [organizationId]),
    ).toHaveLength(0)
    expect(await deleteOrganization(run, organizationId)).toBe(false)
  })
})

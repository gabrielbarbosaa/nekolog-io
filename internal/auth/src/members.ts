import { hashInviteToken, newInviteToken } from './invites.ts'
import { isRole, type Role } from './permissions.ts'
import { MEMBERSHIP_ID_PREFIX, newId } from './signup.ts'
import { normalizeEmail, type SqlRunner } from './users.ts'

export const ORGANIZATION_ID_PREFIX = 'org_'
export const INVITE_ID_PREFIX = 'inv_'
export const AUDIT_ID_PREFIX = 'aud_'

export const INVITE_DAYS = 7
export const MIN_ORGANIZATION_NAME_CHARS = 1
export const MAX_ORGANIZATION_NAME_CHARS = 120
export const AUDIT_PAGE = 100

export function readOrganizationName(input: string): string | undefined {
  const name = input.trim().replace(/\s+/g, ' ')
  return name.length >= MIN_ORGANIZATION_NAME_CHARS && name.length <= MAX_ORGANIZATION_NAME_CHARS
    ? name
    : undefined
}

const CREATE_ORGANIZATION = `
  with organization as (
    insert into organizations (id, name) values ($1, $2) returning id, name
  )
  insert into memberships (id, organization_id, user_id, role)
  select $3, organization.id, $4, 'owner' from organization
  returning organization_id as id
`

const RENAME_ORGANIZATION = `
  update organizations set name = $2 where id = $1 returning id, name
`

const DELETE_ORGANIZATION = `delete from organizations where id = $1 returning id`

const MEMBERSHIPS_OF = `
  select organizations.id, organizations.name, memberships.role
  from memberships
  join organizations on organizations.id = memberships.organization_id
  where memberships.user_id = $1
  order by organizations.name, organizations.id
`

const ROLE_IN = `
  select role from memberships where user_id = $1 and organization_id = $2 limit 1
`

const LIST_MEMBERS = `
  select memberships.id, memberships.role, memberships.created_at,
         users.id as user_id, users.name, users.email
  from memberships
  join users on users.id = memberships.user_id
  where memberships.organization_id = $1
  order by users.name, users.id
`

const ONE_MEMBERSHIP = `
  select id, user_id, role from memberships where organization_id = $1 and id = $2 limit 1
`

const LIST_INVITES = `
  select id, email, role, expires_at, created_at
  from invites
  where organization_id = $1
    and accepted_at is null and revoked_at is null and expires_at > now()
  order by created_at desc
`

const INVITE = `
  insert into invites (id, organization_id, email, role, token_hash, invited_by, expires_at)
  select $1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval
  where not exists (
    select 1 from memberships
    join users on users.id = memberships.user_id
    where memberships.organization_id = $2 and users.email = $3
  )
  on conflict (organization_id, email) where accepted_at is null and revoked_at is null
  do update set role = excluded.role, token_hash = excluded.token_hash,
    invited_by = excluded.invited_by, expires_at = excluded.expires_at, created_at = now()
  returning id
`

const REVOKE_INVITE = `
  update invites set revoked_at = now()
  where organization_id = $1 and id = $2 and accepted_at is null and revoked_at is null
  returning id, email
`

const SOMEBODY_ELSE_OWNS_IT = `exists (
      select 1 from memberships others
      where others.organization_id = $1 and others.role = 'owner' and others.id <> $2
    )`

const CHANGE_ROLE = `
  update memberships set role = $3
  where organization_id = $1 and id = $2
    and (role <> 'owner' or ${SOMEBODY_ELSE_OWNS_IT})
  returning id, user_id, role
`

const REMOVE_MEMBER = `
  delete from memberships
  where organization_id = $1 and id = $2
    and (role <> 'owner' or ${SOMEBODY_ELSE_OWNS_IT})
  returning id, user_id, role
`

const TRANSFER = `
  with promoted as (
    update memberships set role = 'owner'
    where organization_id = $1 and user_id = $2 and role <> 'owner'
    returning id
  )
  update memberships set role = 'admin'
  where organization_id = $1 and user_id = $3 and role = 'owner'
    and exists (select 1 from promoted)
  returning id
`

const RECORD = `
  insert into audit_log
    (id, organization_id, actor_user_id, action, target_type, target_id, metadata, country)
  values ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8)
  returning id
`

const LIST_AUDIT = `
  select audit_log.id, audit_log.action, audit_log.target_type, audit_log.target_id,
         audit_log.metadata, audit_log.country, audit_log.created_at,
         users.name as actor_name, users.email as actor_email
  from audit_log
  left join users on users.id = audit_log.actor_user_id
  where audit_log.organization_id = $1
  order by audit_log.created_at desc, audit_log.id desc
  limit $2
`

export type Organization = { id: string; name: string; role: Role }

export type Member = {
  id: string
  userId: string
  name: string
  email: string
  role: Role
  joinedAt: Date
}

export type PendingInvite = {
  id: string
  email: string
  role: Role
  expiresAt: Date
  createdAt: Date
}

export type AuditEntry = {
  id: string
  action: string
  targetType: string
  targetId: string | undefined
  metadata: unknown
  country: string | undefined
  at: Date
  actor: string | undefined
}

function dateOf(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function roleOf(value: unknown): Role {
  const role = String(value)
  if (!isRole(role)) {
    throw new Error(`the database holds a role this code does not know: ${role}`)
  }
  return role
}

export async function createOrganization(
  run: SqlRunner,
  input: { name: string; ownerUserId: string },
): Promise<string | undefined> {
  const name = readOrganizationName(input.name)
  if (name === undefined) {
    return undefined
  }

  const rows = await run(CREATE_ORGANIZATION, [
    newId(ORGANIZATION_ID_PREFIX),
    name,
    newId(MEMBERSHIP_ID_PREFIX),
    input.ownerUserId,
  ])
  const row = rows[0]
  return row === undefined ? undefined : String(row.id)
}

export async function renameOrganization(
  run: SqlRunner,
  organizationId: string,
  name: string,
): Promise<string | undefined> {
  const wanted = readOrganizationName(name)
  if (wanted === undefined) {
    return undefined
  }

  const rows = await run(RENAME_ORGANIZATION, [organizationId, wanted])
  const row = rows[0]
  return row === undefined ? undefined : String(row.name)
}

export async function deleteOrganization(run: SqlRunner, organizationId: string): Promise<boolean> {
  return (await run(DELETE_ORGANIZATION, [organizationId])).length === 1
}

export async function organizationsOf(run: SqlRunner, userId: string): Promise<Organization[]> {
  const rows = await run(MEMBERSHIPS_OF, [userId])
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: roleOf(row.role),
  }))
}

export async function roleIn(
  run: SqlRunner,
  userId: string,
  organizationId: string,
): Promise<Role | undefined> {
  const rows = await run(ROLE_IN, [userId, organizationId])
  const row = rows[0]
  return row === undefined ? undefined : roleOf(row.role)
}

export async function listMembers(run: SqlRunner, organizationId: string): Promise<Member[]> {
  const rows = await run(LIST_MEMBERS, [organizationId])
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    email: String(row.email),
    role: roleOf(row.role),
    joinedAt: dateOf(row.created_at),
  }))
}

export async function membership(
  run: SqlRunner,
  organizationId: string,
  membershipId: string,
): Promise<{ id: string; userId: string; role: Role } | undefined> {
  const rows = await run(ONE_MEMBERSHIP, [organizationId, membershipId])
  const row = rows[0]
  return row === undefined
    ? undefined
    : { id: String(row.id), userId: String(row.user_id), role: roleOf(row.role) }
}

export async function listInvites(
  run: SqlRunner,
  organizationId: string,
): Promise<PendingInvite[]> {
  const rows = await run(LIST_INVITES, [organizationId])
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    role: roleOf(row.role),
    expiresAt: dateOf(row.expires_at),
    createdAt: dateOf(row.created_at),
  }))
}

export type Invited =
  | { outcome: 'invited'; inviteId: string; token: string; email: string }
  | { outcome: 'already-a-member' }
  | { outcome: 'bad-role' }

export async function inviteMember(
  run: SqlRunner,
  input: { organizationId: string; email: string; role: string; invitedBy: string },
): Promise<Invited> {
  if (!isRole(input.role) || input.role === 'owner') {
    return { outcome: 'bad-role' }
  }

  const email = normalizeEmail(input.email)
  const token = newInviteToken()
  const rows = await run(INVITE, [
    newId(INVITE_ID_PREFIX),
    input.organizationId,
    email,
    input.role,
    hashInviteToken(token),
    input.invitedBy,
    String(INVITE_DAYS),
  ])

  const row = rows[0]
  return row === undefined
    ? { outcome: 'already-a-member' }
    : { outcome: 'invited', inviteId: String(row.id), token, email }
}

export async function revokeInvite(
  run: SqlRunner,
  organizationId: string,
  inviteId: string,
): Promise<string | undefined> {
  const rows = await run(REVOKE_INVITE, [organizationId, inviteId])
  const row = rows[0]
  return row === undefined ? undefined : String(row.email)
}

export type Moved =
  | { outcome: 'changed'; userId: string; role: Role }
  | { outcome: 'the-last-owner' }

export async function changeRole(
  run: SqlRunner,
  organizationId: string,
  membershipId: string,
  role: Role,
): Promise<Moved> {
  const rows = await run(CHANGE_ROLE, [organizationId, membershipId, role])
  const row = rows[0]
  return row === undefined
    ? { outcome: 'the-last-owner' }
    : { outcome: 'changed', userId: String(row.user_id), role: roleOf(row.role) }
}

export async function removeMember(
  run: SqlRunner,
  organizationId: string,
  membershipId: string,
): Promise<Moved> {
  const rows = await run(REMOVE_MEMBER, [organizationId, membershipId])
  const row = rows[0]
  return row === undefined
    ? { outcome: 'the-last-owner' }
    : { outcome: 'changed', userId: String(row.user_id), role: roleOf(row.role) }
}

export async function transferOwnership(
  run: SqlRunner,
  organizationId: string,
  toUserId: string,
  fromUserId: string,
): Promise<boolean> {
  return (await run(TRANSFER, [organizationId, toUserId, fromUserId])).length === 1
}

export async function recordAudit(
  run: SqlRunner,
  entry: {
    organizationId: string
    actorUserId: string | undefined
    action: string
    targetType: string
    targetId?: string | undefined
    metadata?: Record<string, unknown> | undefined
    country?: string | undefined
  },
): Promise<void> {
  await run(RECORD, [
    newId(AUDIT_ID_PREFIX),
    entry.organizationId,
    entry.actorUserId ?? null,
    entry.action,
    entry.targetType,
    entry.targetId ?? null,
    entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
    entry.country === undefined || !/^[A-Z]{2}$/.test(entry.country) ? null : entry.country,
  ])
}

export async function listAudit(
  run: SqlRunner,
  organizationId: string,
  atMost: number = AUDIT_PAGE,
): Promise<AuditEntry[]> {
  const rows = await run(LIST_AUDIT, [organizationId, Math.min(Math.max(atMost, 1), AUDIT_PAGE)])
  return rows.map((row) => ({
    id: String(row.id),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: row.target_id === null ? undefined : String(row.target_id),
    metadata: row.metadata ?? undefined,
    country: row.country === null ? undefined : String(row.country),
    at: dateOf(row.created_at),
    actor:
      row.actor_name === null || row.actor_name === undefined ? undefined : String(row.actor_name),
  }))
}

import { hashInviteToken, newInviteToken } from './invites.ts'
import {
  INVITE_DAYS,
  INVITE_ID_PREFIX,
  ORGANIZATION_ID_PREFIX,
  readOrganizationName,
} from './members.ts'
import { newId } from './signup.ts'
import { normalizeEmail, type SqlRunner } from './users.ts'

export const DEFAULT_DAILY_EVENT_QUOTA = 10_000
export const DEFAULT_MAX_RETENTION_DAYS = 7
export const MAX_DAILY_EVENT_QUOTA = 100_000_000
export const MAX_RETENTION_DAYS = 365
export const ACCOUNT_PAGE = 50

const IS_OPERATOR = `select is_operator from users where id = $1 limit 1`

const LIST_ORGANIZATIONS = `
  select organizations.id, organizations.name, organizations.suspended_at,
         organizations.daily_event_quota, organizations.max_retention_days,
         organizations.created_at,
         (select count(*) from memberships where organization_id = organizations.id) as members,
         (select count(*) from projects where organization_id = organizations.id) as projects
  from organizations
  order by organizations.name, organizations.id
  limit $1
`

const ENVIRONMENTS_OF_EVERY_ORGANIZATION = `
  select environments.id as environment_id, projects.organization_id
  from environments
  join projects on projects.id = environments.project_id
`

const START_AN_ORGANIZATION = `
  with organization as (
    insert into organizations (id, name) values ($1, $2)
    returning id
  )
  insert into invites (id, organization_id, email, role, token_hash, invited_by, expires_at)
  select $3, organization.id, $4, 'admin', $5, $6, now() + ($7 || ' days')::interval
  from organization
  returning id, organization_id
`

const SET_QUOTA = `
  update organizations
  set daily_event_quota = $2, max_retention_days = $3
  where id = $1
  returning id, daily_event_quota, max_retention_days
`

const HOLD_BACK_ENVIRONMENTS = `
  update environments
  set retention_days = $2
  from projects
  where environments.project_id = projects.id
    and projects.organization_id = $1
    and environments.retention_days > $2
  returning environments.id
`

const SUSPEND_ORGANIZATION = `
  update organizations set suspended_at = case when $2 then now() else null end
  where id = $1
  returning id, suspended_at
`

const SUSPEND_USER = `
  update users set suspended_at = case when $2 then now() else null end
  where id = $1
  returning id, suspended_at
`

const LIST_ACCOUNTS = `
  select id, name, email, is_operator, suspended_at, email_verified_at, created_at
  from users
  where $1 = '' or email like '%' || $1 || '%' or lower(name) like '%' || $1 || '%'
  order by created_at desc, id
  limit $2
`

export type OperatedOrganization = {
  id: string
  name: string
  suspendedAt: Date | undefined
  dailyEventQuota: number
  maxRetentionDays: number
  members: number
  projects: number
  createdAt: Date
}

export type OperatedAccount = {
  id: string
  name: string
  email: string
  isOperator: boolean
  suspendedAt: Date | undefined
  emailVerifiedAt: Date | undefined
  createdAt: Date
}

export type Quota = { dailyEventQuota: number; maxRetentionDays: number }

export type QuotaSet =
  | { outcome: 'set'; quota: Quota; environmentsHeldBack: number }
  | { outcome: 'bad-quota' }
  | { outcome: 'no-such-organization' }

export type OrganizationStarted =
  | { outcome: 'started'; organizationId: string; inviteId: string; token: string; email: string }
  | { outcome: 'bad-name' }
  | { outcome: 'bad-address' }

function dateOf(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value
  }
  return typeof value === 'string' ? new Date(value) : undefined
}

function countOf(value: unknown): number {
  return Number(value ?? 0)
}

export async function isOperator(run: SqlRunner, userId: string): Promise<boolean> {
  const rows = await run(IS_OPERATOR, [userId])
  return rows[0]?.is_operator === true
}

export async function listOrganizations(
  run: SqlRunner,
  limit = ACCOUNT_PAGE * 4,
): Promise<OperatedOrganization[]> {
  const rows = await run(LIST_ORGANIZATIONS, [String(limit)])

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    suspendedAt: dateOf(row.suspended_at),
    dailyEventQuota: countOf(row.daily_event_quota),
    maxRetentionDays: countOf(row.max_retention_days),
    members: countOf(row.members),
    projects: countOf(row.projects),
    createdAt: dateOf(row.created_at) ?? new Date(0),
  }))
}

export async function environmentsByOrganization(run: SqlRunner): Promise<Map<string, string[]>> {
  const rows = await run(ENVIRONMENTS_OF_EVERY_ORGANIZATION, [])
  const held = new Map<string, string[]>()

  for (const row of rows) {
    const organizationId = String(row.organization_id)
    const found = held.get(organizationId)
    if (found === undefined) {
      held.set(organizationId, [String(row.environment_id)])
    } else {
      found.push(String(row.environment_id))
    }
  }
  return held
}

export async function listAccounts(
  run: SqlRunner,
  search = '',
  limit = ACCOUNT_PAGE,
): Promise<OperatedAccount[]> {
  const rows = await run(LIST_ACCOUNTS, [search.trim().toLowerCase(), String(limit)])

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    isOperator: row.is_operator === true,
    suspendedAt: dateOf(row.suspended_at),
    emailVerifiedAt: dateOf(row.email_verified_at),
    createdAt: dateOf(row.created_at) ?? new Date(0),
  }))
}

export async function startAnOrganization(
  run: SqlRunner,
  input: { name: string; email: string; invitedBy: string },
): Promise<OrganizationStarted> {
  const name = readOrganizationName(input.name)
  if (name === undefined) {
    return { outcome: 'bad-name' }
  }

  const email = normalizeEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { outcome: 'bad-address' }
  }

  const token = newInviteToken()
  const rows = await run(START_AN_ORGANIZATION, [
    newId(ORGANIZATION_ID_PREFIX),
    name,
    newId(INVITE_ID_PREFIX),
    email,
    hashInviteToken(token),
    input.invitedBy,
    String(INVITE_DAYS),
  ])

  const row = rows[0]
  if (row === undefined) {
    return { outcome: 'bad-name' }
  }

  return {
    outcome: 'started',
    organizationId: String(row.organization_id),
    inviteId: String(row.id),
    token,
    email,
  }
}

export function readQuota(input: {
  dailyEventQuota: unknown
  maxRetentionDays: unknown
}): Quota | undefined {
  const quota = Number(input.dailyEventQuota)
  const retention = Number(input.maxRetentionDays)

  if (!Number.isInteger(quota) || quota < 1 || quota > MAX_DAILY_EVENT_QUOTA) {
    return undefined
  }
  if (!Number.isInteger(retention) || retention < 1 || retention > MAX_RETENTION_DAYS) {
    return undefined
  }
  return { dailyEventQuota: quota, maxRetentionDays: retention }
}

export async function setQuota(
  run: SqlRunner,
  organizationId: string,
  input: { dailyEventQuota: unknown; maxRetentionDays: unknown },
): Promise<QuotaSet> {
  const quota = readQuota(input)
  if (quota === undefined) {
    return { outcome: 'bad-quota' }
  }

  const rows = await run(SET_QUOTA, [
    organizationId,
    String(quota.dailyEventQuota),
    String(quota.maxRetentionDays),
  ])
  if (rows[0] === undefined) {
    return { outcome: 'no-such-organization' }
  }

  const trimmed = await run(HOLD_BACK_ENVIRONMENTS, [
    organizationId,
    String(quota.maxRetentionDays),
  ])

  return { outcome: 'set', quota, environmentsHeldBack: trimmed.length }
}

export async function suspendOrganization(
  run: SqlRunner,
  organizationId: string,
  suspended: boolean,
): Promise<boolean> {
  const rows = await run(SUSPEND_ORGANIZATION, [organizationId, suspended])
  return rows[0] !== undefined
}

export async function suspendUser(
  run: SqlRunner,
  userId: string,
  suspended: boolean,
): Promise<boolean> {
  const rows = await run(SUSPEND_USER, [userId, suspended])
  return rows[0] !== undefined
}

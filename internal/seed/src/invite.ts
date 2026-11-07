import { createHash, randomBytes } from 'node:crypto'
import type { SeedDocument } from './document.ts'
import { id, ORGANIZATION_PREFIX } from './ids.ts'

export const INVITE_PREFIX = 'inv_'
export const MEMBERSHIP_PREFIX = 'mem_'
export const INVITE_TOKEN_BYTES = 32
export const INVITE_DAYS = 7

export const INVITABLE_ROLES: readonly string[] = ['admin', 'member', 'viewer']

export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export class InviteRefused extends Error {}

export function readInviteEmail(value: string | undefined): string {
  const email = (value ?? '').trim().toLowerCase()
  if (!EMAIL_SHAPE.test(email)) {
    throw new InviteRefused(
      `"${value ?? ''}" is not an e-mail address. Use: pnpm seed invite --email you@example.com`,
    )
  }
  return email
}

export function readRole(value: string | undefined): string {
  const role = (value ?? 'admin').trim().toLowerCase()
  if (!INVITABLE_ROLES.includes(role)) {
    throw new InviteRefused(
      `An invitation may grant ${INVITABLE_ROLES.join(', ')} — never owner, which the schema ` +
        'refuses outright. Sign up through the link and run this again to be made the owner.',
    )
  }
  return role
}

export function newInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url')
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function signupLink(appUrl: string, token: string): string {
  let base: URL
  try {
    base = new URL(appUrl)
  } catch {
    throw new InviteRefused(`APP_URL has to be an address, not ${JSON.stringify(appUrl)}`)
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new InviteRefused(`APP_URL has to be http or https, not ${base.protocol}`)
  }
  return new URL(`/signup?invite=${encodeURIComponent(token)}`, base).toString()
}

export function mailWillReach(
  email: string,
  environment: { APP_ENV?: string | undefined; EMAIL_ALLOWLIST?: string | undefined },
): boolean {
  if (environment.APP_ENV === 'prod') {
    return true
  }
  const allowlist = (environment.EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')

  const domain = email.slice(email.indexOf('@'))
  return allowlist.some((entry) => entry === email || (entry.startsWith('@') && entry === domain))
}

export type InviteStatement = { text: string; params: readonly unknown[] }

export const ENSURE_ORGANIZATION = `
  insert into organizations (id, name) values ($1, $2)
  on conflict (id) do nothing
`

export const FIND_ACCOUNT = `select id from users where email = $1 limit 1`

export const OPEN_INVITE = `
  insert into invites (id, organization_id, email, role, token_hash, expires_at)
  select $1, $2, $3, $4, $5, now() + ($6 || ' days')::interval
  where not exists (
    select 1 from memberships
    join users on users.id = memberships.user_id
    where memberships.organization_id = $2 and users.email = $3
  )
  on conflict (organization_id, email) where accepted_at is null and revoked_at is null
  do update set role = excluded.role, token_hash = excluded.token_hash,
    expires_at = excluded.expires_at, created_at = now()
  returning id
`

export const MAKE_OWNER = `
  insert into memberships (id, organization_id, user_id, role)
  values ($1, $2, $3, 'owner')
  on conflict (organization_id, user_id) do update set role = 'owner'
  returning id
`

export function organizationOf(
  document: SeedDocument | undefined,
  fallbackName: string,
): { id: string; name: string } {
  return {
    id: document?.organization.id ?? id(ORGANIZATION_PREFIX, Date.now()),
    name: document?.organization.name ?? fallbackName,
  }
}

export function ensureOrganization(organization: { id: string; name: string }): InviteStatement {
  return { text: ENSURE_ORGANIZATION, params: [organization.id, organization.name] }
}

export function openInvite(input: {
  organizationId: string
  email: string
  role: string
  tokenHash: string
}): InviteStatement {
  return {
    text: OPEN_INVITE,
    params: [
      id(INVITE_PREFIX, Date.now()),
      input.organizationId,
      input.email,
      input.role,
      input.tokenHash,
      String(INVITE_DAYS),
    ],
  }
}

export function makeOwner(organizationId: string, userId: string): InviteStatement {
  return { text: MAKE_OWNER, params: [id(MEMBERSHIP_PREFIX, Date.now()), organizationId, userId] }
}

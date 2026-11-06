import { createHash, randomBytes } from 'node:crypto'
import type { SqlRunner } from './users.ts'

export const INVITE_TOKEN_BYTES = 32

export type OpenInvite = {
  id: string
  organizationId: string
  email: string
  role: string
}

const FIND_OPEN = `
  select id, organization_id, email, role
  from invites
  where token_hash = $1
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  limit 1
`

const CLAIM = `
  with account as (
    update users
    set email_verified_at = coalesce(email_verified_at, now())
    where id = $1
    returning id, email
  ),
  claimed as (
    update invites
    set accepted_at = now()
    where email = (select email from account)
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
    returning id, organization_id, role
  )
  insert into memberships (id, organization_id, user_id, role)
  select $2, claimed.organization_id, (select id from account), claimed.role
  from claimed
  on conflict (organization_id, user_id) do nothing
  returning id, organization_id
`

export function newInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url')
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function findOpenInvite(
  run: SqlRunner,
  token: string,
): Promise<OpenInvite | undefined> {
  if (token.trim() === '') {
    return undefined
  }

  const rows = await run(FIND_OPEN, [hashInviteToken(token)])
  const row = rows[0]
  if (row === undefined) {
    return undefined
  }

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    email: String(row.email),
    role: String(row.role),
  }
}

export async function claimInvite(
  run: SqlRunner,
  userId: string,
  membershipId: string,
): Promise<{ joined: string } | undefined> {
  const rows = await run(CLAIM, [userId, membershipId])
  const row = rows[0]
  return row === undefined ? undefined : { joined: String(row.organization_id) }
}

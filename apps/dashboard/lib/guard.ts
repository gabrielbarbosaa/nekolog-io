import 'server-only'
import {
  type AccessClaims,
  findAccountById,
  may,
  originAllowed,
  type Permission,
  type Role,
  roleIn,
  verifyPassword,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from './auth'
import { liveSession } from './session'

export type Allowed = { claims: AccessClaims; role: Role; organizationId: string }

export type Guarded = { allowed: Allowed } | { refused: NextResponse }

export function refusal(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}

export async function guard(
  request: Request,
  organizationId: string,
  permission: Permission,
  options: { writes?: boolean } = {},
): Promise<Guarded> {
  if (
    options.writes !== false &&
    !originAllowed(request.headers.get('origin'), authSettings().appUrl)
  ) {
    return { refused: refusal('bad_origin', 403) }
  }

  const claims = await liveSession(request)
  if (claims === undefined) {
    return { refused: refusal('signed_out', 401) }
  }

  const role = await roleIn(loginDeps().run, claims.sub, organizationId)
  if (role === undefined) {
    return { refused: refusal('no_such_organization', 404) }
  }

  if (!may(role, permission)) {
    return { refused: refusal('not_allowed', 403) }
  }

  return { allowed: { claims, role, organizationId } }
}

export async function theyTypedTheirPassword(userId: string, password: string): Promise<boolean> {
  const account = await findAccountById(loginDeps().run, userId)
  return account !== undefined && (await verifyPassword(account.passwordHash, password))
}

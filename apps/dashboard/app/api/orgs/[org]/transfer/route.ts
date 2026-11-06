import { membership, recordAudit, transferOwnership } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal, theyTypedTheirPassword } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await guard(request, org, 'organization:delete')
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  if (!(await theyTypedTheirPassword(gate.allowed.claims.sub, stringField(body, 'password')))) {
    return refusal('invalid_credentials', 401)
  }

  const run = loginDeps().run
  const heir = await membership(run, org, stringField(body, 'member'))
  if (heir === undefined) {
    return refusal('no_such_member', 404)
  }
  if (heir.userId === gate.allowed.claims.sub) {
    return refusal('already_the_owner', 409)
  }

  if (!(await transferOwnership(run, org, heir.userId, gate.allowed.claims.sub))) {
    return refusal('not_transferred', 409)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'organization.ownership_transferred',
    targetType: 'membership',
    targetId: heir.id,
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'transferred' })
}

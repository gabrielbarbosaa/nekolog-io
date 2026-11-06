import { changeRole, isRole, mayActOn, mayGrant, membership, recordAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await guard(request, org, 'members:write')
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  const role = stringField(body, 'role')
  if (!isRole(role)) {
    return refusal('bad_role', 422)
  }

  const run = loginDeps().run
  const target = await membership(run, org, stringField(body, 'member'))
  if (target === undefined) {
    return refusal('no_such_member', 404)
  }

  if (!mayActOn(gate.allowed.role, target.role) || !mayGrant(gate.allowed.role, role)) {
    return refusal('not_allowed', 403)
  }

  const moved = await changeRole(run, org, target.id, role)
  if (moved.outcome === 'the-last-owner') {
    return refusal('the_last_owner', 409)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'member.role_changed',
    targetType: 'membership',
    targetId: target.id,
    metadata: { from: target.role, to: role },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'role-changed', role })
}

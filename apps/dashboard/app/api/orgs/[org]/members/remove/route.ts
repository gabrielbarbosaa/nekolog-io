import { mayActOn, membership, recordAudit, removeMember } from '@internal/auth'
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

  const run = loginDeps().run
  const target = await membership(run, org, stringField(await jsonBody(request), 'member'))
  if (target === undefined) {
    return refusal('no_such_member', 404)
  }

  if (!mayActOn(gate.allowed.role, target.role)) {
    return refusal('not_allowed', 403)
  }

  const removed = await removeMember(run, org, target.id)
  if (removed.outcome === 'the-last-owner') {
    return refusal('the_last_owner', 409)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'member.removed',
    targetType: 'membership',
    targetId: target.id,
    metadata: { role: target.role },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'removed' })
}

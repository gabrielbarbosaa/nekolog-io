import { recordAudit, revokeInvite } from '@internal/auth'
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
  const inviteId = stringField(await jsonBody(request), 'invite')
  const revoked = await revokeInvite(run, org, inviteId)

  if (revoked === undefined) {
    return refusal('no_such_invite', 404)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'invite.revoked',
    targetType: 'invite',
    targetId: inviteId,
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'revoked' })
}

import { recordAudit, revokeKey } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string; key: string }> },
): Promise<Response> {
  const { org, project, key } = await params
  const gate = await guard(request, org, 'keys:write')
  if ('refused' in gate) {
    return gate.refused
  }

  const run = loginDeps().run
  const revoked = await revokeKey(run, org, project, key)
  if (revoked === undefined) {
    return refusal('no_such_key', 404)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'key.revoked',
    targetType: 'api_key',
    targetId: key,
    metadata: { project, environment: revoked.environmentId, hint: revoked.hint },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'revoked' })
}

import { recordAudit, rotateKey } from '@internal/auth'
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
  const rotated = await rotateKey(run, org, project, key)
  if (rotated.outcome === 'no-such-key') {
    return refusal('no_such_key', 404)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'key.rotated',
    targetType: 'api_key',
    targetId: rotated.keyId,
    metadata: { project, environment: rotated.environmentId, replaced: key, hint: rotated.hint },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ key: rotated.keyId, value: rotated.value, hint: rotated.hint })
}

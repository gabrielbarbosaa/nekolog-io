import { findEnvironment, isKeyKind, mintKey, recordAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string; env: string }> },
): Promise<Response> {
  const { org, project, env } = await params
  const gate = await guard(request, org, 'keys:write')
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  const kind = stringField(body, 'kind')
  if (!isKeyKind(kind)) {
    return refusal('unknown_kind', 422)
  }

  const run = loginDeps().run
  if ((await findEnvironment(run, org, project, env)) === undefined) {
    return refusal('no_such_environment', 404)
  }

  const minted = await mintKey(run, {
    organizationId: org,
    projectId: project,
    environmentId: env,
    kind,
    ...(body.scopes === undefined ? {} : { scopes: body.scopes }),
  })

  if (minted.outcome === 'bad-scopes') {
    return refusal('bad_scopes', 422)
  }
  if (minted.outcome !== 'minted') {
    return refusal('too_many_keys', 409)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'key.created',
    targetType: 'api_key',
    targetId: minted.keyId,
    metadata: { project, environment: env, kind, hint: minted.hint },
    country: countryOf(request.headers),
  })

  return NextResponse.json(
    { key: minted.keyId, value: minted.value, hint: minted.hint },
    { status: 201 },
  )
}

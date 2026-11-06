import { createEnvironment, findProject, recordAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string }> },
): Promise<Response> {
  const { org, project } = await params
  const gate = await guard(request, org, 'projects:write')
  if ('refused' in gate) {
    return gate.refused
  }

  const run = loginDeps().run
  if ((await findProject(run, org, project)) === undefined) {
    return refusal('no_such_project', 404)
  }

  const body = await jsonBody(request)
  const color = stringField(body, 'color')
  const created = await createEnvironment(run, {
    organizationId: org,
    projectId: project,
    name: stringField(body, 'name'),
    color: color === '' ? undefined : color,
  })

  if (created.outcome === 'bad-name') {
    return refusal('bad_name', 422)
  }
  if (created.outcome === 'unknown-color') {
    return refusal('unknown_color', 422)
  }
  if (created.outcome === 'name-taken') {
    return refusal('name_taken', 409)
  }
  if (created.outcome === 'too-many') {
    return refusal('too_many_environments', 409)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'environment.created',
    targetType: 'environment',
    targetId: created.environmentId,
    metadata: { project, name: created.name },
    country: countryOf(request.headers),
  })

  return NextResponse.json(
    { environment: created.environmentId, name: created.name },
    { status: 201 },
  )
}

import { createProject, listProjects, recordAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await guard(request, org, 'logs:read', { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  return NextResponse.json({ projects: await listProjects(loginDeps().run, org) })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await guard(request, org, 'projects:write')
  if ('refused' in gate) {
    return gate.refused
  }

  const run = loginDeps().run
  const created = await createProject(run, {
    organizationId: org,
    name: stringField(await jsonBody(request), 'name'),
  })

  if (created.outcome === 'bad-name') {
    return refusal('bad_name', 422)
  }
  if (created.outcome === 'no-such-organization') {
    return refusal('no_such_organization', 404)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'project.created',
    targetType: 'project',
    targetId: created.projectId,
    metadata: { environments: created.environments.map((one) => one.name) },
    country: countryOf(request.headers),
  })

  return NextResponse.json(
    { project: created.projectId, environments: created.environments },
    { status: 201 },
  )
}

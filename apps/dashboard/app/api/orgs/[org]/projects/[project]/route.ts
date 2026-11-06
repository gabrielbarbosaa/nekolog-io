import { findProject, listEnvironments, recordAudit, renameProject } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string }> },
): Promise<Response> {
  const { org, project } = await params
  const gate = await guard(request, org, 'logs:read', { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const run = loginDeps().run
  const found = await findProject(run, org, project)
  if (found === undefined) {
    return refusal('no_such_project', 404)
  }

  return NextResponse.json({
    project: found,
    environments: await listEnvironments(run, org, project),
    you: gate.allowed.role,
  })
}

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
  const name = stringField(await jsonBody(request), 'name')
  const renamed = await renameProject(run, org, project, name)
  if (renamed === undefined) {
    return (await findProject(run, org, project)) === undefined
      ? refusal('no_such_project', 404)
      : refusal('bad_name', 422)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'project.renamed',
    targetType: 'project',
    targetId: project,
    metadata: { to: renamed },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'renamed', name: renamed })
}

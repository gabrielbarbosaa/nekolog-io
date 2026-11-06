import { deleteProject, recordAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal, theyTypedTheirPassword } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string }> },
): Promise<Response> {
  const { org, project } = await params
  const gate = await guard(request, org, 'projects:delete')
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  if (!(await theyTypedTheirPassword(gate.allowed.claims.sub, stringField(body, 'password')))) {
    return refusal('invalid_credentials', 401)
  }

  const run = loginDeps().run
  const name = await deleteProject(run, org, project)
  if (name === undefined) {
    return refusal('no_such_project', 404)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'project.deleted',
    targetType: 'project',
    targetId: project,
    metadata: { name },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'deleted' })
}

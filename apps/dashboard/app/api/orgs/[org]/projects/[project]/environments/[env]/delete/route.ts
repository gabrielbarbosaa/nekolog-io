import { deleteEnvironment, findEnvironment, recordAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string; env: string }> },
): Promise<Response> {
  const { org, project, env } = await params
  const gate = await guard(request, org, 'projects:write')
  if ('refused' in gate) {
    return gate.refused
  }

  const run = loginDeps().run
  const removed = await deleteEnvironment(run, org, project, env)
  if (removed.outcome === 'the-last-environment') {
    return (await findEnvironment(run, org, project, env)) === undefined
      ? refusal('no_such_environment', 404)
      : refusal('the_last_environment', 409)
  }

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'environment.deleted',
    targetType: 'environment',
    targetId: env,
    metadata: { project, name: removed.name },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'deleted' })
}

import { readEnvironmentSettings, recordAudit, updateEnvironment } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf, jsonBody } from '@/lib/request'

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

  const read = readEnvironmentSettings(await jsonBody(request))
  if ('refused' in read) {
    return NextResponse.json({ error: read.refused, field: read.field }, { status: 422 })
  }

  const run = loginDeps().run
  const written = await updateEnvironment(run, {
    organizationId: org,
    projectId: project,
    environmentId: env,
    settings: read.settings,
  })

  if (written.outcome === 'over-the-cap') {
    return NextResponse.json(
      { error: 'over_the_retention_cap', field: 'retentionDays', cap: written.cap },
      { status: 422 },
    )
  }
  if (written.outcome !== 'written') {
    return refusal('no_such_environment', 404)
  }

  const { name } = written

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'environment.settings_changed',
    targetType: 'environment',
    targetId: env,
    metadata: {
      project,
      name,
      retentionDays: read.settings.retentionDays,
      minLevel: read.settings.minLevel,
      sampleRate: read.settings.sampleRate,
      origins: read.settings.originAllowlist?.length ?? null,
    },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'saved', settings: read.settings })
}

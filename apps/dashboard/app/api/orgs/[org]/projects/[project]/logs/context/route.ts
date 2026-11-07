import { listEnvironments } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { contextAround } from '@/lib/logs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const CONTEXT_PARAMETERS: readonly string[] = ['env', 'at']

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string }> },
): Promise<Response> {
  const { org, project } = await params
  const gate = await guard(request, org, 'logs:read', { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const asked = new URL(request.url).searchParams
  for (const name of asked.keys()) {
    if (!CONTEXT_PARAMETERS.includes(name)) {
      return refusal('unknown_parameter', 400)
    }
  }

  const environments = await listEnvironments(loginDeps().run, org, project)
  const environment = environments.find((one) => one.id === (asked.get('env') ?? ''))
  if (environment === undefined) {
    return refusal('no_such_environment', 404)
  }

  const anchor = new Date(asked.get('at') ?? '')
  if (Number.isNaN(anchor.getTime())) {
    return refusal('bad_period', 422)
  }

  try {
    const rows = await contextAround({
      projectId: project,
      environmentId: environment.id,
      anchor,
    })

    return NextResponse.json({ rows }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[nekolog/dashboard] the log context failed', error)
    return refusal('logs_unavailable', 503)
  }
}

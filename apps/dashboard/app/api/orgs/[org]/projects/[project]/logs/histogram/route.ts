import { listEnvironments } from '@internal/auth'
import { SearchError } from '@nekolog-io/clickhouse/search'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { bucketFor, secondsOf } from '@/lib/histogram'
import { countVolume } from '@/lib/logs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const HISTOGRAM_PARAMETERS: readonly string[] = ['env', 'q', 'from', 'to']

export const MAX_SPAN_MS: number = 31 * 24 * 60 * 60 * 1000

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
    if (!HISTOGRAM_PARAMETERS.includes(name)) {
      return refusal('unknown_parameter', 400)
    }
  }

  const environments = await listEnvironments(loginDeps().run, org, project)
  if (environments.length === 0) {
    return refusal('no_such_project', 404)
  }

  const wanted = asked.get('env') ?? ''
  const scoped = wanted === '' ? environments : environments.filter((one) => one.id === wanted)
  if (scoped.length === 0) {
    return refusal('no_such_environment', 404)
  }

  const from = new Date(asked.get('from') ?? '')
  const to = new Date(asked.get('to') ?? '')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return refusal('bad_period', 422)
  }
  if (to.getTime() <= from.getTime() || to.getTime() - from.getTime() > MAX_SPAN_MS) {
    return refusal('bad_period', 422)
  }

  const bucket = bucketFor(from.getTime(), to.getTime())

  const named: Record<string, string> = {}
  for (const one of environments) {
    named[one.name] = one.id
  }

  try {
    const rows = await countVolume({
      projectId: project,
      environmentIds: scoped.map((one) => one.id),
      from,
      to,
      search: asked.get('q') ?? '',
      environments: named,
      bucket,
    })

    return NextResponse.json(
      { rows, bucket, seconds: secondsOf(bucket) },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof SearchError) {
      return NextResponse.json({ error: 'bad_search', detail: error.message }, { status: 422 })
    }
    console.error('[nekolog/dashboard] the volume query failed', error)
    return refusal('logs_unavailable', 503)
  }
}

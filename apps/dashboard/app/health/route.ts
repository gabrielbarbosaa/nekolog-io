import { readiness } from '@/lib/readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const state = await readiness()
  const body = {
    app: 'nekolog/dashboard',
    version: process.env.DASHBOARD_VERSION ?? 'dev',
    time: new Date().toISOString(),
  }

  if (!state.ready) {
    return Response.json(
      { status: 'degraded', problem: state.problem, detail: state.detail, ...body },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  return Response.json({ status: 'ok', ...body }, { headers: { 'cache-control': 'no-store' } })
}

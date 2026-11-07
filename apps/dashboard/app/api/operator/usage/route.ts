import { environmentsByOrganization } from '@internal/auth'
import { clickHouseUsageStore } from '@nekolog-io/clickhouse/usage-store'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { refusal } from '@/lib/guard'
import { clickHouse } from '@/lib/logs'
import { operatorGuard } from '@/lib/operator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const USAGE_PARAMETERS: readonly string[] = ['hours']

export const DEFAULT_HOURS = 24
export const MAX_HOURS = 24 * 30

export async function GET(request: Request): Promise<Response> {
  const gate = await operatorGuard(request, { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const asked = new URL(request.url).searchParams
  for (const name of asked.keys()) {
    if (!USAGE_PARAMETERS.includes(name)) {
      return refusal('unknown_parameter', 400)
    }
  }

  const hours = Number(asked.get('hours') ?? DEFAULT_HOURS)
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    return refusal('bad_period', 422)
  }

  const byOrganization = await environmentsByOrganization(loginDeps().run)

  try {
    const counted = await clickHouseUsageStore(clickHouse()).eventsSince(
      Date.now() - hours * 60 * 60 * 1000,
    )
    const events = new Map(counted.map((one) => [one.environmentId, one.events]))

    const usage: Record<string, number> = {}
    for (const [organizationId, environments] of byOrganization) {
      usage[organizationId] = environments.reduce(
        (sum, environmentId) => sum + (events.get(environmentId) ?? 0),
        0,
      )
    }

    return NextResponse.json({ hours, usage }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[nekolog/dashboard] the usage query failed', error)
    return refusal('logs_unavailable', 503)
  }
}

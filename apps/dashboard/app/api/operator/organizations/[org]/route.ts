import { setQuota, suspendOrganization } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { refusal } from '@/lib/guard'
import { operatorGuard } from '@/lib/operator'
import { booleanField, jsonBody } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await operatorGuard(request)
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  const run = loginDeps().run

  if (body.suspended !== undefined) {
    const suspended = booleanField(body, 'suspended')
    if (!(await suspendOrganization(run, org, suspended))) {
      return refusal('no_such_organization', 404)
    }
    return NextResponse.json({ status: suspended ? 'suspended' : 'restored' })
  }

  const set = await setQuota(run, org, {
    dailyEventQuota: body.dailyEventQuota,
    maxRetentionDays: body.maxRetentionDays,
  })

  if (set.outcome === 'bad-quota') {
    return refusal('bad_quota', 422)
  }
  if (set.outcome !== 'set') {
    return refusal('no_such_organization', 404)
  }

  return NextResponse.json({
    status: 'set',
    dailyEventQuota: set.quota.dailyEventQuota,
    maxRetentionDays: set.quota.maxRetentionDays,
    environmentsHeldBack: set.environmentsHeldBack,
  })
}

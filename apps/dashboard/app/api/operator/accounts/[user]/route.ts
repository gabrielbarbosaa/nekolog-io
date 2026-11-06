import { revokeEverySession, suspendUser } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { refusal } from '@/lib/guard'
import { operatorGuard } from '@/lib/operator'
import { booleanField, jsonBody } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ user: string }> },
): Promise<Response> {
  const { user } = await params
  const gate = await operatorGuard(request)
  if ('refused' in gate) {
    return gate.refused
  }

  if (user === gate.allowed.userId) {
    return refusal('not_yourself', 409)
  }

  const suspended = booleanField(await jsonBody(request), 'suspended')
  const deps = loginDeps()

  if (!(await suspendUser(deps.run, user, suspended))) {
    return refusal('no_such_account', 404)
  }

  if (suspended) {
    await revokeEverySession({ redis: deps.redis }, user)
  }

  return NextResponse.json({ status: suspended ? 'suspended' : 'restored' })
}

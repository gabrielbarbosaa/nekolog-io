import { NextResponse } from 'next/server'
import { refusal, theyTypedTheirPassword } from '@/lib/guard'
import { lock, operatorGuard, UNLOCK_SECONDS, unlock } from '@/lib/operator'
import { jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const gate = await operatorGuard(request, { needsUnlock: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  if (!(await theyTypedTheirPassword(gate.allowed.userId, stringField(body, 'password')))) {
    return refusal('invalid_credentials', 401)
  }

  await unlock(gate.allowed.sessionId)
  return NextResponse.json({ status: 'unlocked', seconds: UNLOCK_SECONDS })
}

export async function DELETE(request: Request): Promise<Response> {
  const gate = await operatorGuard(request, { needsUnlock: false })
  if ('refused' in gate) {
    return gate.refused
  }

  await lock(gate.allowed.sessionId)
  return NextResponse.json({ status: 'locked' })
}

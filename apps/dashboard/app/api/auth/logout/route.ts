import { ACCESS_COOKIE, CHALLENGE_COOKIE, originAllowed, REFRESH_COOKIE } from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings } from '@/lib/auth'
import { clearCookie } from '@/lib/cookies'
import { endSession, sessionFrom } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const claims = await sessionFrom(request)
  if (claims !== undefined) {
    await endSession(claims)
  }

  const response = NextResponse.json({ status: 'signed-out' })
  clearCookie(response, ACCESS_COOKIE)
  clearCookie(response, REFRESH_COOKIE)
  clearCookie(response, CHALLENGE_COOKIE)
  return response
}

import {
  ACCESS_COOKIE,
  CHALLENGE_COOKIE,
  originAllowed,
  REFRESH_COOKIE,
  revokeEverySession,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings } from '@/lib/auth'
import { clearCookie } from '@/lib/cookies'
import { liveSession, sessionStore } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const claims = await liveSession(request)
  if (claims === undefined) {
    return NextResponse.json({ error: 'signed_out' }, { status: 401 })
  }

  const ended = await revokeEverySession(sessionStore(), claims.sub)

  const response = NextResponse.json({ status: 'signed-out-everywhere', ended })
  clearCookie(response, ACCESS_COOKIE)
  clearCookie(response, REFRESH_COOKIE)
  clearCookie(response, CHALLENGE_COOKIE)
  return response
}

import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  cookieAttributes,
  livesFor,
  originAllowed,
  REFRESH_COOKIE,
  renewSession,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings } from '@/lib/auth'
import { clearCookie, cookieFrom } from '@/lib/cookies'
import { renewDeps } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function signedOut(error: string): NextResponse {
  const response = NextResponse.json({ error }, { status: 401 })
  clearCookie(response, ACCESS_COOKIE)
  clearCookie(response, REFRESH_COOKIE)
  return response
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const cookie = request.headers.get('cookie')
  const renewal = await renewSession(await renewDeps(), {
    accessToken: cookieFrom(cookie, ACCESS_COOKIE),
    refreshToken: cookieFrom(cookie, REFRESH_COOKIE),
  })

  if (renewal.outcome === 'carry-on') {
    return NextResponse.json({ status: 'signed-in' })
  }

  if (renewal.outcome === 'reused') {
    console.warn(
      `a refresh token came back after the grace window; ended the session of ${renewal.userId}`,
    )
    return signedOut('session_ended')
  }

  if (renewal.outcome === 'anonymous') {
    return signedOut('signed_out')
  }

  const { idle } = livesFor(renewal.remember)
  const response = NextResponse.json({ status: 'renewed' })

  response.cookies.set(
    ACCESS_COOKIE,
    renewal.accessToken,
    cookieAttributes(renewal.remember ? ACCESS_TTL_SECONDS : undefined),
  )
  if (renewal.refreshToken !== undefined) {
    response.cookies.set(
      REFRESH_COOKIE,
      renewal.refreshToken,
      cookieAttributes(renewal.remember ? idle : undefined),
    )
  }

  return response
}

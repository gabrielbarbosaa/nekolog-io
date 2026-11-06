import { CHALLENGE_COOKIE, finishEmailChange, openChallenge, originAllowed } from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { clearCookie, cookieFrom } from '@/lib/cookies'
import { noticeLater } from '@/lib/notices'
import { jsonBody, stringField } from '@/lib/request'
import { liveSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const settings = authSettings()

  if (!originAllowed(request.headers.get('origin'), settings.appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const claims = await liveSession(request)
  if (claims === undefined) {
    return NextResponse.json({ error: 'signed_out' }, { status: 401 })
  }

  const attempt = openChallenge(
    settings.otpSecret,
    cookieFrom(request.headers.get('cookie'), CHALLENGE_COOKIE),
  )
  if (attempt === undefined || attempt.userId !== claims.sub) {
    return NextResponse.json({ error: 'start_again' }, { status: 401 })
  }

  const body = await jsonBody(request)
  const done = await finishEmailChange(loginDeps(), {
    userId: claims.sub,
    challenge: attempt.challenge,
    currentCode: stringField(body, 'currentCode'),
    newCode: stringField(body, 'newCode'),
  })

  if (done.outcome === 'wrong-code') {
    return NextResponse.json({ error: 'wrong_code' }, { status: 401 })
  }
  if (done.outcome === 'taken') {
    return NextResponse.json({ error: 'address_taken' }, { status: 409 })
  }
  if (done.outcome === 'start-again') {
    const gone = NextResponse.json({ error: 'start_again' }, { status: 401 })
    clearCookie(gone, CHALLENGE_COOKIE)
    return gone
  }

  noticeLater(
    'email-changed',
    { email: done.account.email, locale: done.account.locale },
    request.headers,
  )
  noticeLater('email-changed', { email: done.email, locale: done.account.locale }, request.headers)

  const response = NextResponse.json({ status: 'email-changed', email: done.email })
  clearCookie(response, CHALLENGE_COOKIE)
  return response
}

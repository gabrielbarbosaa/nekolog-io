import {
  ACCESS_COOKIE,
  CHALLENGE_COOKIE,
  finishRecovery,
  openChallenge,
  originAllowed,
  REFRESH_COOKIE,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { clearCookie, cookieFrom } from '@/lib/cookies'
import { noticeLater } from '@/lib/notices'
import { jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const settings = authSettings()

  if (!originAllowed(request.headers.get('origin'), settings.appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const attempt = openChallenge(
    settings.otpSecret,
    cookieFrom(request.headers.get('cookie'), CHALLENGE_COOKIE),
  )
  if (attempt === undefined) {
    return NextResponse.json({ error: 'start_again' }, { status: 401 })
  }

  const body = await jsonBody(request)
  const done = await finishRecovery(loginDeps(), {
    userId: attempt.userId,
    challenge: attempt.challenge,
    code: stringField(body, 'code'),
    password: stringField(body, 'password'),
  })

  if (done.outcome === 'bad-password') {
    return NextResponse.json({ error: 'weak_password', refusal: done.refusal }, { status: 422 })
  }
  if (done.outcome === 'wrong-code') {
    return NextResponse.json({ error: 'wrong_code' }, { status: 401 })
  }
  if (done.outcome === 'start-again') {
    const gone = NextResponse.json({ error: 'start_again' }, { status: 401 })
    clearCookie(gone, CHALLENGE_COOKIE)
    return gone
  }

  noticeLater('password-changed', done.account, request.headers)

  const response = NextResponse.json({ status: 'password-changed' })
  clearCookie(response, CHALLENGE_COOKIE)
  clearCookie(response, ACCESS_COOKIE)
  clearCookie(response, REFRESH_COOKIE)
  return response
}

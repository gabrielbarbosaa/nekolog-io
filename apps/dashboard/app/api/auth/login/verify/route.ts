import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  CHALLENGE_COOKIE,
  cookieAttributes,
  finishLogin,
  livesFor,
  loadSigningKey,
  openChallenge,
  originAllowed,
  REFRESH_COOKIE,
  signAccessToken,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { booleanField, countryOf, deviceOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function signingPem(): string {
  const key = process.env.AUTH_JWT_PRIVATE_KEY
  if (key === undefined || key.trim() === '') {
    throw new Error('AUTH_JWT_PRIVATE_KEY is not set, so no session can be signed.')
  }
  return key.replace(/\\n/g, '\n')
}

export async function POST(request: Request): Promise<Response> {
  const settings = authSettings()

  if (!originAllowed(request.headers.get('origin'), settings.appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CHALLENGE_COOKIE}=`))
    ?.slice(CHALLENGE_COOKIE.length + 1)

  const attempt = openChallenge(settings.otpSecret, cookie)
  if (attempt === undefined) {
    return NextResponse.json({ error: 'start_again' }, { status: 401 })
  }

  const body = await jsonBody(request)
  const remember = booleanField(body, 'remember')

  const finished = await finishLogin(loginDeps(), {
    userId: attempt.userId,
    challenge: attempt.challenge,
    code: stringField(body, 'code'),
    remember,
    device: deviceOf(request.headers),
    country: countryOf(request.headers),
  })

  if (finished.outcome === 'wrong-code') {
    return NextResponse.json({ error: 'wrong_code' }, { status: 401 })
  }
  if (finished.outcome === 'start-again') {
    const gone = NextResponse.json({ error: 'start_again' }, { status: 401 })
    gone.cookies.delete(CHALLENGE_COOKIE)
    return gone
  }

  const accessToken = await signAccessToken(await loadSigningKey(signingPem()), {
    sub: attempt.userId,
    sid: finished.session.sid,
  })

  const { idle } = livesFor(remember)
  const response = NextResponse.json({ status: 'signed-in' })

  response.cookies.set(
    ACCESS_COOKIE,
    accessToken,
    cookieAttributes(remember ? ACCESS_TTL_SECONDS : undefined),
  )
  response.cookies.set(
    REFRESH_COOKIE,
    finished.session.refreshToken,
    cookieAttributes(remember ? idle : undefined),
  )
  response.cookies.delete(CHALLENGE_COOKIE)

  return response
}

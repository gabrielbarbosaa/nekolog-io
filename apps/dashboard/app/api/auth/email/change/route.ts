import {
  CHALLENGE_COOKIE,
  cookieAttributes,
  originAllowed,
  sealChallenge,
  startEmailChange,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { codeLater } from '@/lib/notices'
import { jsonBody, stringField } from '@/lib/request'
import { liveSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const CHALLENGE_MAX_AGE_SECONDS = 15 * 60

export async function POST(request: Request): Promise<Response> {
  const settings = authSettings()

  if (!originAllowed(request.headers.get('origin'), settings.appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const claims = await liveSession(request)
  if (claims === undefined) {
    return NextResponse.json({ error: 'signed_out' }, { status: 401 })
  }

  const body = await jsonBody(request)
  const started = await startEmailChange(loginDeps(), {
    userId: claims.sub,
    password: stringField(body, 'password'),
    email: stringField(body, 'email'),
  })

  if (started.outcome === 'wrong-password') {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }
  if (started.outcome === 'bad-address') {
    return NextResponse.json({ error: 'bad_address' }, { status: 422 })
  }
  if (started.outcome === 'taken') {
    return NextResponse.json({ error: 'address_taken' }, { status: 409 })
  }
  if (started.outcome === 'wait') {
    return NextResponse.json({ error: 'too_many_sends' }, { status: 429 })
  }

  codeLater('change-email-current', started.account, started.currentCode, request.headers)
  codeLater(
    'change-email',
    { email: started.newEmail, locale: started.account.locale },
    started.newCode,
    request.headers,
  )

  const response = NextResponse.json({ status: 'codes-sent' })
  response.cookies.set(
    CHALLENGE_COOKIE,
    sealChallenge(settings.otpSecret, claims.sub, started.challenge),
    cookieAttributes(CHALLENGE_MAX_AGE_SECONDS),
  )
  return response
}

import {
  CHALLENGE_COOKIE,
  checkTurnstile,
  cookieAttributes,
  newChallenge,
  newId,
  originAllowed,
  sealChallenge,
  startRecovery,
  USER_ID_PREFIX,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { codeLater } from '@/lib/notices'
import { addressOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const CHALLENGE_MAX_AGE_SECONDS = 15 * 60

export async function POST(request: Request): Promise<Response> {
  const settings = authSettings()

  if (!originAllowed(request.headers.get('origin'), settings.appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const body = await jsonBody(request)
  const ip = addressOf(request.headers)

  const human = await checkTurnstile(stringField(body, 'turnstileToken'), ip, {
    secret: settings.turnstileSecret,
  })
  if (human === 'refused') {
    return NextResponse.json({ error: 'challenge_failed' }, { status: 403 })
  }

  const started = await startRecovery(loginDeps(), { email: stringField(body, 'email'), ip })

  if (started.outcome === 'slow-down') {
    return NextResponse.json(
      { error: 'too_many_attempts' },
      { status: 429, headers: { 'retry-after': String(started.retryAfterSeconds) } },
    )
  }

  const sealed =
    started.outcome === 'code-sent'
      ? sealChallenge(settings.otpSecret, started.account.id, started.challenge)
      : sealChallenge(settings.otpSecret, newId(USER_ID_PREFIX), newChallenge())

  if (started.outcome === 'code-sent') {
    codeLater('reset-password', started.account, started.code, request.headers)
  }

  const response = NextResponse.json({ status: 'code-sent' })
  response.cookies.set(CHALLENGE_COOKIE, sealed, cookieAttributes(CHALLENGE_MAX_AGE_SECONDS))
  return response
}

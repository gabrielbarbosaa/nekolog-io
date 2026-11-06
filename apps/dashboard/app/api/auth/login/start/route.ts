import {
  CHALLENGE_COOKIE,
  checkTurnstile,
  codeEmail,
  cookieAttributes,
  originAllowed,
  sealChallenge,
  startLogin,
} from '@internal/auth'
import { after, NextResponse } from 'next/server'
import { authSettings, loginDeps, mail } from '@/lib/auth'
import { addressOf, countryOf, deviceOf, jsonBody, stringField } from '@/lib/request'

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

  const started = await startLogin(loginDeps(), {
    email: stringField(body, 'email'),
    password: stringField(body, 'password'),
    ip,
  })

  if (started.outcome === 'slow-down') {
    return NextResponse.json(
      { error: 'too_many_attempts' },
      { status: 429, headers: { 'retry-after': String(started.retryAfterSeconds) } },
    )
  }

  if (started.outcome === 'refused') {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  const notice = codeEmail({
    purpose: 'login',
    code: started.code,
    locale: started.account.locale,
    device: deviceOf(request.headers),
    country: countryOf(request.headers),
    at: Date.now(),
  })

  after(async () => {
    try {
      await mail().send({
        to: started.account.email,
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
      })
    } catch (error) {
      console.error('the sign-in code could not be sent', error)
    }
  })

  const response = NextResponse.json({ status: 'code-sent' })
  response.cookies.set(
    CHALLENGE_COOKIE,
    sealChallenge(settings.otpSecret, started.account.id, started.challenge),
    cookieAttributes(CHALLENGE_MAX_AGE_SECONDS),
  )
  return response
}

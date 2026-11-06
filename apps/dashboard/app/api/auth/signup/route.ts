import {
  CHALLENGE_COOKIE,
  checkTurnstile,
  codeEmail,
  cookieAttributes,
  originAllowed,
  sealChallenge,
  signUp,
} from '@internal/auth'
import { after, NextResponse } from 'next/server'
import { authSettings, loginDeps, mail } from '@/lib/auth'
import { addressOf, countryOf, deviceOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const SIGNUP_CHALLENGE_MAX_AGE_SECONDS = 15 * 60

const STATUS: Record<string, number> = {
  'no-invite': 404,
  'bad-name': 400,
  'bad-password': 400,
  'account-exists': 409,
  wait: 429,
}

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

  const signed = await signUp(loginDeps(), {
    token: stringField(body, 'invite'),
    name: stringField(body, 'name'),
    password: stringField(body, 'password'),
    locale: stringField(body, 'locale') || 'en',
  })

  if (signed.outcome !== 'code-sent') {
    const detail = signed.outcome === 'bad-password' ? { reason: signed.refusal } : {}
    return NextResponse.json(
      { error: signed.outcome.replace(/-/g, '_'), ...detail },
      { status: STATUS[signed.outcome] ?? 400 },
    )
  }

  const notice = codeEmail({
    purpose: 'verify-email',
    code: signed.code,
    locale: stringField(body, 'locale'),
    device: deviceOf(request.headers),
    country: countryOf(request.headers),
    at: Date.now(),
  })

  after(async () => {
    try {
      await mail().send({
        to: signed.email,
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
      })
    } catch (error) {
      console.error('the confirmation could not be sent', error)
    }
  })

  const response = NextResponse.json({ status: 'code-sent', email: signed.email })
  response.cookies.set(
    CHALLENGE_COOKIE,
    sealChallenge(settings.otpSecret, signed.userId, signed.challenge),
    cookieAttributes(SIGNUP_CHALLENGE_MAX_AGE_SECONDS),
  )
  return response
}

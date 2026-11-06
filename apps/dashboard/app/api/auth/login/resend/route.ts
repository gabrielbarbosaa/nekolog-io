import {
  CHALLENGE_COOKIE,
  codeEmail,
  openChallenge,
  originAllowed,
  RESEND_COOLDOWN_SECONDS,
  resendCode,
} from '@internal/auth'
import { after, NextResponse } from 'next/server'
import { authSettings, loginDeps, mail } from '@/lib/auth'
import { cookieFrom } from '@/lib/cookies'
import { countryOf, deviceOf } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIND_BY_ID = `
  select id, email, name, password_hash, email_verified_at, suspended_at, locale, timezone
  from users
  where id = $1
  limit 1
`

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

  const deps = loginDeps()
  const issued = await resendCode(deps, attempt.userId, attempt.challenge)

  if (issued.outcome === 'wait') {
    return NextResponse.json(
      { error: 'too_soon' },
      { status: 429, headers: { 'retry-after': String(RESEND_COOLDOWN_SECONDS) } },
    )
  }

  const rows = await deps.run(FIND_BY_ID, [attempt.userId])
  const account = rows[0]
  if (account === undefined) {
    return NextResponse.json({ error: 'start_again' }, { status: 401 })
  }

  const notice = codeEmail({
    purpose: 'login',
    code: issued.code,
    locale: String(account.locale),
    device: deviceOf(request.headers),
    country: countryOf(request.headers),
    at: Date.now(),
  })

  after(async () => {
    try {
      await mail().send({
        to: String(account.email),
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
      })
    } catch (error) {
      console.error('the sign-in code could not be sent again', error)
    }
  })

  return NextResponse.json({ status: 'code-sent' })
}

import {
  CHALLENGE_COOKIE,
  claimInvite,
  MEMBERSHIP_ID_PREFIX,
  newId,
  openChallenge,
  originAllowed,
  verifyCode,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function challengeFrom(cookieHeader: string | null): string | undefined {
  return (
    cookieHeader
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${CHALLENGE_COOKIE}=`))
      ?.slice(CHALLENGE_COOKIE.length + 1) ?? undefined
  )
}

export async function POST(request: Request): Promise<Response> {
  const settings = authSettings()

  if (!originAllowed(request.headers.get('origin'), settings.appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const attempt = openChallenge(settings.otpSecret, challengeFrom(request.headers.get('cookie')))
  if (attempt === undefined) {
    return NextResponse.json({ error: 'start_again' }, { status: 401 })
  }

  const deps = loginDeps()
  const body = await jsonBody(request)

  const read = await verifyCode(
    { redis: deps.redis, secret: deps.otpSecret },
    'verify-email',
    attempt.userId,
    attempt.challenge,
    stringField(body, 'code'),
  )

  if (read === 'wrong') {
    return NextResponse.json({ error: 'wrong_code' }, { status: 401 })
  }
  if (read !== 'accepted') {
    const gone = NextResponse.json({ error: 'start_again' }, { status: 401 })
    gone.cookies.delete(CHALLENGE_COOKIE)
    return gone
  }

  const claimed = await claimInvite(deps.run, attempt.userId, newId(MEMBERSHIP_ID_PREFIX))
  if (claimed === undefined) {
    return NextResponse.json({ error: 'no_invite' }, { status: 409 })
  }

  const response = NextResponse.json({ status: 'confirmed', organization: claimed.joined })
  response.cookies.delete(CHALLENGE_COOKIE)
  return response
}

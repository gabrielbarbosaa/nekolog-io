import {
  ACCESS_COOKIE,
  cookieAttributes,
  createSession,
  findDemoAccount,
  loadSigningKey,
  mayOpenADemo,
  originAllowed,
  REFRESH_COOKIE,
  signAccessToken,
} from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { refusal } from '@/lib/guard'
import { addressOf, countryOf, deviceOf } from '@/lib/request'

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
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return refusal('bad_origin', 403)
  }

  const deps = loginDeps()
  const ip = addressOf(request.headers)

  const allowed = await mayOpenADemo(deps.redis, ip)
  if (!allowed.allowed) {
    return NextResponse.json(
      { error: 'too_many_attempts' },
      { status: 429, headers: { 'retry-after': String(allowed.retryAfterSeconds) } },
    )
  }

  const demo = await findDemoAccount(deps.run)
  if (demo === undefined) {
    return refusal('demo_unavailable', 503)
  }

  const session = await createSession(
    { redis: deps.redis },
    {
      userId: demo.userId,
      remember: false,
      device: deviceOf(request.headers),
      country: countryOf(request.headers),
    },
  )

  const accessToken = await signAccessToken(await loadSigningKey(signingPem()), {
    sub: demo.userId,
    sid: session.sid,
  })

  const response = NextResponse.json({
    status: 'looking',
    organization: demo.organizationId,
  })

  response.cookies.set(ACCESS_COOKIE, accessToken, cookieAttributes(undefined))
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, cookieAttributes(undefined))

  return response
}

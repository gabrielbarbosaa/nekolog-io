import { ACCESS_COOKIE, changePassword, originAllowed, REFRESH_COOKIE } from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { clearCookie } from '@/lib/cookies'
import { notTheDemo } from '@/lib/demo'
import { noticeLater } from '@/lib/notices'
import { jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const gate = await notTheDemo(request)
  if ('refused' in gate) {
    return gate.refused
  }
  const { claims } = gate

  const body = await jsonBody(request)
  const done = await changePassword(loginDeps(), {
    userId: claims.sub,
    current: stringField(body, 'current'),
    next: stringField(body, 'next'),
  })

  if (done.outcome === 'wrong-password') {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }
  if (done.outcome === 'bad-password') {
    return NextResponse.json({ error: 'weak_password', refusal: done.refusal }, { status: 422 })
  }

  noticeLater('password-changed', done.account, request.headers)

  const response = NextResponse.json({ status: 'password-changed' })
  clearCookie(response, ACCESS_COOKIE)
  clearCookie(response, REFRESH_COOKIE)
  return response
}

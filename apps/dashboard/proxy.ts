import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  cookieAttributes,
  livesFor,
  originAllowed,
  REFRESH_COOKIE,
  renewSession,
} from '@internal/auth'
import { newNonce, nonceSource, securityHeaders } from '@internal/security-headers'
import { type NextRequest, NextResponse } from 'next/server'
import { clearCookie, cookieFrom, withCookies } from './lib/cookies'
import { NONCE_HEADER } from './lib/nonce'
import { renewDeps } from './lib/session'

const UNSAFE = ['POST', 'PUT', 'PATCH', 'DELETE']
const UNGUARDED = ['/health']

function expectedOrigin(request: NextRequest): string {
  const configured = process.env.APP_URL
  return configured === undefined || configured.trim() === '' ? request.nextUrl.origin : configured
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = newNonce()
  const headers = securityHeaders({
    scriptSources: [nonceSource(nonce)],
    styleSources: [nonceSource(nonce)],
    strictDynamic: true,
  })

  const unguarded = UNGUARDED.includes(request.nextUrl.pathname)

  if (!unguarded && UNSAFE.includes(request.method)) {
    if (!originAllowed(request.headers.get('origin'), expectedOrigin(request))) {
      const refused = NextResponse.json({ error: 'bad_origin' }, { status: 403 })
      for (const [name, value] of Object.entries(headers)) {
        refused.headers.set(name, value)
      }
      return refused
    }
  }

  const cookie = request.headers.get('cookie')
  const accessToken = cookieFrom(cookie, ACCESS_COOKIE)
  const refreshToken = cookieFrom(cookie, REFRESH_COOKIE)

  const renewal =
    unguarded || refreshToken === undefined
      ? undefined
      : await renewSession(await renewDeps(), { accessToken, refreshToken })

  const forwarded = new Headers(request.headers)
  forwarded.set(NONCE_HEADER, nonce)

  const written: Record<string, string> = {}
  if (renewal?.outcome === 'renewed') {
    written[ACCESS_COOKIE] = renewal.accessToken
    if (renewal.refreshToken !== undefined) {
      written[REFRESH_COOKIE] = renewal.refreshToken
    }
  }
  if (renewal?.outcome === 'anonymous' || renewal?.outcome === 'reused') {
    written[ACCESS_COOKIE] = ''
    written[REFRESH_COOKIE] = ''
  }

  if (Object.keys(written).length > 0) {
    forwarded.set('cookie', withCookies(cookie, written))
  }

  const response = NextResponse.next({ request: { headers: forwarded } })
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value)
  }

  if (renewal?.outcome === 'renewed') {
    const { idle } = livesFor(renewal.remember)
    response.cookies.set(
      ACCESS_COOKIE,
      renewal.accessToken,
      cookieAttributes(renewal.remember ? ACCESS_TTL_SECONDS : undefined),
    )
    if (renewal.refreshToken !== undefined) {
      response.cookies.set(
        REFRESH_COOKIE,
        renewal.refreshToken,
        cookieAttributes(renewal.remember ? idle : undefined),
      )
    }
  }

  if (renewal?.outcome === 'anonymous' || renewal?.outcome === 'reused') {
    clearCookie(response, ACCESS_COOKIE)
    clearCookie(response, REFRESH_COOKIE)
  }

  if (renewal?.outcome === 'reused') {
    console.warn(
      `a refresh token came back after the grace window; ended the session of ${renewal.userId}`,
    )
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}

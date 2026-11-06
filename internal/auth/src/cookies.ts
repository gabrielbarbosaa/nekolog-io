import { createHmac, timingSafeEqual } from 'node:crypto'

export const ACCESS_COOKIE = '__Host-at'
export const REFRESH_COOKIE = '__Host-rt'
export const CHALLENGE_COOKIE = '__Host-lc'

export type CookieAttributes = {
  httpOnly: true
  secure: true
  sameSite: 'lax'
  path: '/'
  maxAge?: number
}

export function cookieAttributes(maxAgeSeconds?: number): CookieAttributes {
  const attributes: CookieAttributes = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  }
  return maxAgeSeconds === undefined ? attributes : { ...attributes, maxAge: maxAgeSeconds }
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`login-challenge:${body}`).digest('base64url')
}

export function sealChallenge(secret: string, userId: string, challenge: string): string {
  const body = `${userId}.${challenge}`
  return `${body}.${sign(secret, body)}`
}

export function openChallenge(
  secret: string,
  cookie: string | undefined,
): { userId: string; challenge: string } | undefined {
  if (cookie === undefined) {
    return undefined
  }

  const parts = cookie.split('.')
  if (parts.length !== 3) {
    return undefined
  }

  const [userId, challenge, signature] = parts as [string, string, string]
  if (userId === '' || challenge === '') {
    return undefined
  }

  const expected = Buffer.from(sign(secret, `${userId}.${challenge}`))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return undefined
  }

  return { userId, challenge }
}

export function originAllowed(origin: string | null, allowed: string): boolean {
  if (origin === null || origin === '') {
    return false
  }
  try {
    return new URL(origin).origin === new URL(allowed).origin
  } catch {
    return false
  }
}

import 'server-only'
import {
  ACCESS_COOKIE,
  type AccessClaims,
  type RenewDeps,
  revokeSession,
  sessionLives,
  verifyAccessToken,
} from '@internal/auth'
import { cookies } from 'next/headers'
import { cookieFrom } from './cookies'
import { signingKey, verifyingKeys } from './keys'
import { redisClient } from './redis'

export const SIGN_IN_PATH = '/sign-in'

export async function renewDeps(): Promise<RenewDeps> {
  return {
    redis: redisClient(),
    signing: await signingKey(),
    verifying: await verifyingKeys(),
  }
}

export async function sessionFrom(request: Request): Promise<AccessClaims | undefined> {
  const token = cookieFrom(request.headers.get('cookie'), ACCESS_COOKIE)
  return token === undefined ? undefined : verifyAccessToken(await verifyingKeys(), token)
}

export async function currentSession(): Promise<AccessClaims | undefined> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value
  return token === undefined || token === ''
    ? undefined
    : verifyAccessToken(await verifyingKeys(), token)
}

export async function liveSession(claims: AccessClaims | undefined): Promise<boolean> {
  return claims !== undefined && (await sessionLives({ redis: redisClient() }, claims.sid))
}

export async function endSession(claims: AccessClaims): Promise<void> {
  await revokeSession({ redis: redisClient() }, claims.sid)
}

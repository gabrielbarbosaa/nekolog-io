import type { RedisClient } from '@nekolog-io/adapters'
import {
  type AccessClaims,
  type SigningKey,
  signAccessToken,
  type VerifyingKey,
  verifyAccessToken,
} from './jwt.ts'
import { rotateRefresh } from './sessions.ts'

export type RenewDeps = {
  redis: RedisClient
  signing: SigningKey
  verifying: ReadonlyArray<VerifyingKey>
}

export type Carried = { accessToken?: string | undefined; refreshToken?: string | undefined }

export type Renewal =
  | { outcome: 'carry-on'; claims: AccessClaims }
  | {
      outcome: 'renewed'
      claims: AccessClaims
      accessToken: string
      refreshToken?: string
      remember: boolean
    }
  | { outcome: 'reused'; userId: string }
  | { outcome: 'anonymous' }

export async function renewSession(
  deps: RenewDeps,
  carried: Carried,
  options: { now?: number } = {},
): Promise<Renewal> {
  if (carried.accessToken !== undefined && carried.accessToken !== '') {
    const claims = await verifyAccessToken(deps.verifying, carried.accessToken)
    if (claims !== undefined) {
      return { outcome: 'carry-on', claims }
    }
  }

  if (carried.refreshToken === undefined || carried.refreshToken === '') {
    return { outcome: 'anonymous' }
  }

  const rotation = await rotateRefresh({ redis: deps.redis }, carried.refreshToken, options)

  if (rotation.outcome === 'unknown') {
    return { outcome: 'anonymous' }
  }
  if (rotation.outcome === 'reused') {
    return { outcome: 'reused', userId: rotation.userId }
  }
  if (rotation.userId === '') {
    return { outcome: 'anonymous' }
  }

  const sid = carried.refreshToken.split('.')[0] as string
  const claims: AccessClaims = { sub: rotation.userId, sid }
  const accessToken = await signAccessToken(deps.signing, claims)

  return rotation.outcome === 'rotated'
    ? {
        outcome: 'renewed',
        claims,
        accessToken,
        refreshToken: rotation.refreshToken,
        remember: rotation.remember,
      }
    : { outcome: 'renewed', claims, accessToken, remember: rotation.remember }
}

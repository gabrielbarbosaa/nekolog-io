import 'server-only'
import { isOperator, originAllowed } from '@internal/auth'
import type { NextResponse } from 'next/server'
import { authSettings, loginDeps } from './auth'
import { refusal } from './guard'
import { redisClient } from './redis'
import { liveSession } from './session'

export const UNLOCK_SECONDS = 15 * 60

export function unlockKey(sessionId: string): string {
  return `operator:unlocked:${sessionId}`
}

export async function unlock(sessionId: string): Promise<void> {
  await redisClient().set(unlockKey(sessionId), '1', { exSeconds: UNLOCK_SECONDS })
}

export async function unlocked(sessionId: string): Promise<boolean> {
  return (await redisClient().get(unlockKey(sessionId))) !== null
}

export async function lock(sessionId: string): Promise<void> {
  await redisClient().del(unlockKey(sessionId))
}

export type Operating = { userId: string; sessionId: string }

export type OperatorGuarded = { allowed: Operating } | { refused: NextResponse }

export async function operatorGuard(
  request: Request,
  options: { needsUnlock?: boolean; writes?: boolean } = {},
): Promise<OperatorGuarded> {
  if (
    options.writes !== false &&
    !originAllowed(request.headers.get('origin'), authSettings().appUrl)
  ) {
    return { refused: refusal('bad_origin', 403) }
  }

  const claims = await liveSession(request)
  if (claims === undefined) {
    return { refused: refusal('signed_out', 401) }
  }

  if (!(await isOperator(loginDeps().run, claims.sub))) {
    return { refused: refusal('not_found', 404) }
  }

  if (options.needsUnlock !== false && !(await unlocked(claims.sid))) {
    return { refused: refusal('locked', 403) }
  }

  return { allowed: { userId: claims.sub, sessionId: claims.sid } }
}

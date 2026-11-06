import { createHash, randomBytes } from 'node:crypto'
import type { RedisClient } from '@nekolog-io/adapters'
import { CREATE_SESSION, REVOKE_EVERY_SESSION, REVOKE_SESSION, ROTATE_REFRESH } from './scripts.ts'

export const REFRESH_IDLE_SECONDS = 7 * 24 * 60 * 60
export const REFRESH_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60
export const UNREMEMBERED_SECONDS = 12 * 60 * 60
export const GRACE_MS = 30_000
export const SESSION_ID_BYTES = 16
export const REFRESH_SECRET_BYTES = 32

export type SessionStore = { redis: RedisClient }

export type Device = { device: string; country: string }

export type NewSession = {
  userId: string
  remember: boolean
  now?: number
} & Device

export type Session = { sid: string; refreshToken: string; absoluteExpiry: number }

export type Rotation =
  | { outcome: 'rotated'; refreshToken: string }
  | { outcome: 'within-grace' }
  | { outcome: 'reused' }
  | { outcome: 'unknown' }

export function sessionKey(sid: string): string {
  return `sess:${sid}`
}

export function userSessionsKey(userId: string): string {
  return `sess:user:${userId}`
}

export function newSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url')
}

export function newRefreshToken(sid: string): string {
  return `${sid}.${randomBytes(REFRESH_SECRET_BYTES).toString('base64url')}`
}

export function sessionIdOf(refreshToken: string): string | undefined {
  const sid = refreshToken.split('.')[0]
  return sid !== undefined && sid !== '' && refreshToken.includes('.') ? sid : undefined
}

export function hashToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex')
}

export function livesFor(remember: boolean): { idle: number; absolute: number } {
  return remember
    ? { idle: REFRESH_IDLE_SECONDS, absolute: REFRESH_ABSOLUTE_SECONDS }
    : { idle: UNREMEMBERED_SECONDS, absolute: UNREMEMBERED_SECONDS }
}

export async function createSession(store: SessionStore, session: NewSession): Promise<Session> {
  const now = session.now ?? Date.now()
  const sid = newSessionId()
  const refreshToken = newRefreshToken(sid)
  const { idle, absolute } = livesFor(session.remember)
  const absoluteExpiry = now + absolute * 1000

  await store.redis.eval(
    CREATE_SESSION,
    [sessionKey(sid), userSessionsKey(session.userId)],
    [
      hashToken(refreshToken),
      String(absoluteExpiry),
      String(now),
      session.userId,
      session.device,
      session.country,
      String(idle),
      sid,
      String(absolute),
    ],
  )

  return { sid, refreshToken, absoluteExpiry }
}

export async function rotateRefresh(
  store: SessionStore,
  refreshToken: string,
  options: { now?: number; remember?: boolean } = {},
): Promise<Rotation> {
  const sid = sessionIdOf(refreshToken)
  if (!sid) {
    return { outcome: 'unknown' }
  }

  const now = options.now ?? Date.now()
  const next = newRefreshToken(sid)
  const { idle } = livesFor(options.remember ?? true)

  const answer = await store.redis.eval(
    ROTATE_REFRESH,
    [sessionKey(sid)],
    [hashToken(refreshToken), hashToken(next), String(now), String(now + GRACE_MS), String(idle)],
  )

  switch (Number(answer)) {
    case 1:
      return { outcome: 'rotated', refreshToken: next }
    case 2:
      return { outcome: 'within-grace' }
    case -1:
      return { outcome: 'reused' }
    default:
      return { outcome: 'unknown' }
  }
}

export async function sessionLives(store: SessionStore, sid: string): Promise<boolean> {
  const [cur] = await store.redis.hmget(sessionKey(sid), ['cur'])
  return cur !== null && cur !== undefined
}

export async function revokeSession(store: SessionStore, sid: string): Promise<void> {
  await store.redis.eval(REVOKE_SESSION, [sessionKey(sid)], [sid])
}

export async function revokeEverySession(store: SessionStore, userId: string): Promise<number> {
  const answer = await store.redis.eval(REVOKE_EVERY_SESSION, [userSessionsKey(userId)], [])
  return Number(answer)
}

import { describe, expect, it } from 'vitest'
import {
  GRACE_MS,
  hashToken,
  livesFor,
  newRefreshToken,
  newSessionId,
  REFRESH_ABSOLUTE_SECONDS,
  REFRESH_IDLE_SECONDS,
  REFRESH_SECRET_BYTES,
  SESSION_ID_BYTES,
  sessionIdOf,
  sessionKey,
  UNREMEMBERED_SECONDS,
  userSessionsKey,
} from './sessions.ts'

describe('the numbers section 11.3 writes down', () => {
  it('are these, and the integration tests are written against them', () => {
    expect(REFRESH_IDLE_SECONDS).toBe(7 * 24 * 60 * 60)
    expect(REFRESH_ABSOLUTE_SECONDS).toBe(30 * 24 * 60 * 60)
    expect(UNREMEMBERED_SECONDS).toBe(12 * 60 * 60)
    expect(GRACE_MS).toBe(30_000)
  })

  it('gives an unremembered session no more than twelve hours either way', () => {
    expect(livesFor(false)).toEqual({ idle: 43_200, absolute: 43_200 })
    expect(livesFor(true)).toEqual({ idle: 604_800, absolute: 2_592_000 })
  })

  it('names the keys section 11.7 lists', () => {
    expect(sessionKey('abc')).toBe('sess:abc')
    expect(userSessionsKey('usr_1')).toBe('sess:user:usr_1')
  })
})

describe('the shape of a refresh token', () => {
  it('is a session id, a dot, and a secret', () => {
    const sid = newSessionId()
    const token = newRefreshToken(sid)
    const [front, back] = token.split('.')

    expect(front).toBe(sid)
    expect(Buffer.from(front as string, 'base64url')).toHaveLength(SESSION_ID_BYTES)
    expect(Buffer.from(back as string, 'base64url')).toHaveLength(REFRESH_SECRET_BYTES)
  })

  it('carries nothing that is not safe in a cookie', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(newRefreshToken(newSessionId())).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    }
  })

  it('never repeats, which a broken source of randomness would', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newRefreshToken(newSessionId())))

    expect(seen.size).toBe(500)
  })

  it('gives up the session id without trusting the rest', () => {
    expect(sessionIdOf('abc.secret')).toBe('abc')
    expect(sessionIdOf('abc.')).toBe('abc')
  })

  it('reads no session id out of something that is not one', () => {
    for (const broken of ['', 'abc', '.secret', '.']) {
      expect(sessionIdOf(broken), broken).toBeUndefined()
    }
  })
})

describe('what Redis stores instead of the token', () => {
  it('is a SHA-256, so the token itself is never written down', () => {
    const token = newRefreshToken(newSessionId())
    const stored = hashToken(token)

    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).not.toContain(token.split('.')[1] as string)
  })

  it('tells two tokens apart, including two that share a session id', () => {
    const sid = newSessionId()

    expect(hashToken(newRefreshToken(sid))).not.toBe(hashToken(newRefreshToken(sid)))
  })
})

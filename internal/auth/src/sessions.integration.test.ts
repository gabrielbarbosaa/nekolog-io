import { nodeRedis, type RedisClient } from '@nekolog-io/adapters'
import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSession,
  GRACE_MS,
  hashToken,
  listSessions,
  REFRESH_ABSOLUTE_SECONDS,
  REFRESH_IDLE_SECONDS,
  revokeEverySession,
  revokeOwnSession,
  revokeSession,
  rotateRefresh,
  type SessionStore,
  sessionKey,
  sessionLives,
  UNREMEMBERED_SECONDS,
  userSessionsKey,
} from './sessions.ts'

const URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379'

async function answers(): Promise<boolean> {
  const probe = new Redis(URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  try {
    await probe.connect()
    await probe.ping()
    return true
  } catch {
    return false
  } finally {
    probe.disconnect()
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.REDIS_TEST_REQUIRED === '1') {
    throw new Error(
      `REDIS_TEST_REQUIRED is set but nothing answered at ${URL}. These tests must not be skipped here.`,
    )
  }
  process.stderr.write(
    `\nSkipping the session integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

let raw: Redis
let store: SessionStore
const run = `ses${process.pid}`
let seed = 0

function user(): string {
  seed += 1
  return `${run}_${seed}`
}

const SOMEWHERE = { device: 'Firefox on Linux', country: 'BR' }

beforeAll(() => {
  raw = new Redis(URL)
  store = { redis: nodeRedis(raw) as RedisClient }
})

afterAll(() => {
  raw?.disconnect()
})

describe.skipIf(!reachable)('a session against a real Redis', () => {
  it('stores the hash of the refresh token, never the token', async () => {
    const userId = user()
    const session = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    const stored = await raw.hgetall(sessionKey(session.sid))

    expect(stored.cur).toBe(hashToken(session.refreshToken))
    expect(Object.values(stored)).not.toContain(session.refreshToken)
    expect(stored.userId).toBe(userId)
    expect(stored.device).toBe(SOMEWHERE.device)
  })

  it('belongs to its user, so signing out everywhere can find it', async () => {
    const userId = user()
    const session = await createSession(store, { userId, remember: true, ...SOMEWHERE })

    expect(await raw.smembers(userSessionsKey(userId))).toEqual([session.sid])
  })

  it('lives seven days when remembered and twelve hours when not', async () => {
    const remembered = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    const forgotten = await createSession(store, { userId: user(), remember: false, ...SOMEWHERE })

    expect(await raw.ttl(sessionKey(remembered.sid))).toBeGreaterThan(REFRESH_IDLE_SECONDS - 10)
    expect(await raw.ttl(sessionKey(forgotten.sid))).toBeLessThanOrEqual(UNREMEMBERED_SECONDS)
    expect(await raw.ttl(sessionKey(forgotten.sid))).toBeGreaterThan(UNREMEMBERED_SECONDS - 10)
  })
})

describe.skipIf(!reachable)('rotating the refresh token', () => {
  it('hands back a new one and refuses the old after the grace window', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    const rotated = await rotateRefresh(store, session.refreshToken)

    expect(rotated.outcome).toBe('rotated')
    const next = (rotated as { refreshToken: string }).refreshToken
    expect(next).not.toBe(session.refreshToken)

    const later = await rotateRefresh(store, session.refreshToken, {
      now: Date.now() + GRACE_MS + 1,
    })
    expect(later.outcome).toBe('reused')
    expect(await sessionLives(store, session.sid)).toBe(false)
  })

  it('answers ten parallel requests without ending the session', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    const rotatedAt = Date.now()
    const first = await rotateRefresh(store, session.refreshToken, { now: rotatedAt })
    expect(first.outcome).toBe('rotated')

    const racing = await Promise.all(
      Array.from({ length: 10 }, () =>
        rotateRefresh(store, session.refreshToken, { now: rotatedAt + 15_000 }),
      ),
    )

    expect(racing.map((answer) => answer.outcome)).toEqual(Array(10).fill('within-grace'))
    expect(await sessionLives(store, session.sid)).toBe(true)
  })

  it('holds the grace window open to its last millisecond, and not past it', async () => {
    const edge = async (offset: number) => {
      const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
      const at = Date.now()
      await rotateRefresh(store, session.refreshToken, { now: at })
      return (await rotateRefresh(store, session.refreshToken, { now: at + offset })).outcome
    }

    expect(await edge(GRACE_MS)).toBe('within-grace')
    expect(await edge(GRACE_MS + 1)).toBe('reused')
  })

  it('reads a token for a session that is gone as unknown, not as theft', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    await revokeSession(store, session.sid)

    expect((await rotateRefresh(store, session.refreshToken)).outcome).toBe('unknown')
  })

  it('ends the session when a used token comes back after the grace window', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    await rotateRefresh(store, session.refreshToken)

    const reused = await rotateRefresh(store, session.refreshToken, {
      now: Date.now() + GRACE_MS + 1,
    })

    expect(reused.outcome).toBe('reused')
    expect(await sessionLives(store, session.sid)).toBe(false)
  })

  it('refuses a token nobody issued without touching the session', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    const stranger = `${session.sid}.somebody-made-this-up`

    expect((await rotateRefresh(store, stranger)).outcome).toBe('unknown')
    expect(await sessionLives(store, session.sid)).toBe(true)
  })

  it('refuses a session that passed the thirty-day ceiling, and removes it', async () => {
    const started = Date.now() - REFRESH_ABSOLUTE_SECONDS * 1000 - 1
    const session = await createSession(store, {
      userId: user(),
      remember: true,
      now: started,
      ...SOMEWHERE,
    })
    await raw.persist(sessionKey(session.sid))

    expect((await rotateRefresh(store, session.refreshToken)).outcome).toBe('unknown')
    expect(await sessionLives(store, session.sid)).toBe(false)
  })

  it('refuses a refresh token with no session id in it', async () => {
    expect((await rotateRefresh(store, 'no-dot-here')).outcome).toBe('unknown')
  })

  it('names the owner, so the new access token is signed for the session and not for a token', async () => {
    const userId = user()
    const session = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    const rotated = await rotateRefresh(store, session.refreshToken)

    expect(rotated).toMatchObject({ outcome: 'rotated', userId, remember: true })
  })

  it('names the owner of a stolen token too, which is who gets the warning', async () => {
    const userId = user()
    const session = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    await rotateRefresh(store, session.refreshToken)

    const reused = await rotateRefresh(store, session.refreshToken, {
      now: Date.now() + GRACE_MS + 1,
    })

    expect(reused).toEqual({ outcome: 'reused', userId })
  })

  it('keeps an unremembered session on twelve hours, so renewing never promotes it', async () => {
    const session = await createSession(store, { userId: user(), remember: false, ...SOMEWHERE })
    const rotated = await rotateRefresh(store, session.refreshToken)

    expect(rotated).toMatchObject({ outcome: 'rotated', remember: false })
    expect(await raw.ttl(sessionKey(session.sid))).toBeLessThanOrEqual(UNREMEMBERED_SECONDS)
    expect(await raw.ttl(sessionKey(session.sid))).toBeGreaterThan(UNREMEMBERED_SECONDS - 10)
  })

  it('pushes a remembered session back out to seven days every time it renews', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    await raw.expire(sessionKey(session.sid), 60)

    expect((await rotateRefresh(store, session.refreshToken)).outcome).toBe('rotated')
    expect(await raw.ttl(sessionKey(session.sid))).toBeGreaterThan(REFRESH_IDLE_SECONDS - 10)
  })
})

describe.skipIf(!reachable)('revoking', () => {
  it('removes one session and takes it out of the user list', async () => {
    const userId = user()
    const kept = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    const dropped = await createSession(store, { userId, remember: true, ...SOMEWHERE })

    await revokeSession(store, dropped.sid)

    expect(await sessionLives(store, dropped.sid)).toBe(false)
    expect(await sessionLives(store, kept.sid)).toBe(true)
    expect(await raw.smembers(userSessionsKey(userId))).toEqual([kept.sid])
  })

  it('removes every session of one user and leaves another user alone', async () => {
    const mine = user()
    const theirs = user()
    const first = await createSession(store, { userId: mine, remember: true, ...SOMEWHERE })
    const second = await createSession(store, { userId: mine, remember: true, ...SOMEWHERE })
    const untouched = await createSession(store, { userId: theirs, remember: true, ...SOMEWHERE })

    expect(await revokeEverySession(store, mine)).toBe(2)
    expect(await sessionLives(store, first.sid)).toBe(false)
    expect(await sessionLives(store, second.sid)).toBe(false)
    expect(await sessionLives(store, untouched.sid)).toBe(true)
    expect(await raw.exists(userSessionsKey(mine))).toBe(0)
  })

  it('ends one of your own sessions from the list', async () => {
    const userId = user()
    const kept = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    const dropped = await createSession(store, { userId, remember: true, ...SOMEWHERE })

    expect(await revokeOwnSession(store, userId, dropped.sid)).toBe(true)
    expect(await sessionLives(store, dropped.sid)).toBe(false)
    expect(await sessionLives(store, kept.sid)).toBe(true)
    expect(await raw.smembers(userSessionsKey(userId))).toEqual([kept.sid])
  })

  it('never ends somebody else’s, even knowing the session id', async () => {
    const mine = user()
    const theirs = user()
    const stranger = await createSession(store, { userId: theirs, remember: true, ...SOMEWHERE })

    expect(await revokeOwnSession(store, mine, stranger.sid)).toBe(false)
    expect(await sessionLives(store, stranger.sid)).toBe(true)
  })

  it('answers false for a session id that is not there at all', async () => {
    expect(await revokeOwnSession(store, user(), 'no-such-session')).toBe(false)
  })

  it('takes a dead member out of the list rather than showing it', async () => {
    const userId = user()
    const alive = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    const expired = await createSession(store, { userId, remember: true, ...SOMEWHERE })
    await raw.del(sessionKey(expired.sid))

    const listed = await listSessions(store, userId)

    expect(listed.map((row) => row.sid)).toEqual([alive.sid])
    expect(await raw.smembers(userSessionsKey(userId))).toEqual([alive.sid])
  })

  it('is immediately visible, which is what a sensitive action checks', async () => {
    const session = await createSession(store, { userId: user(), remember: true, ...SOMEWHERE })
    expect(await sessionLives(store, session.sid)).toBe(true)

    await revokeSession(store, session.sid)
    expect(await sessionLives(store, session.sid)).toBe(false)
  })
})

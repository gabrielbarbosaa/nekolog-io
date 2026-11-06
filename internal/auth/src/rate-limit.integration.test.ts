import { nodeRedis, type RedisClient } from '@nekolog-io/adapters'
import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ACCOUNT_ATTEMPTS,
  ATTEMPT_WINDOW_SECONDS,
  forgetFailures,
  IP_ATTEMPTS,
  limitKey,
  mayAttempt,
  recordFailure,
} from './rate-limit.ts'

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
    `\nSkipping the rate limit integration tests: nothing answered at ${URL}.\n\n`,
  )
}

let raw: Redis
let redis: RedisClient
const run = `rl${process.pid}`
let seed = 0

function pair(): { account: string; ip: string } {
  seed += 1
  return { account: `${run}_a${seed}`, ip: `${run}_i${seed}` }
}

beforeAll(() => {
  raw = new Redis(URL)
  redis = nodeRedis(raw) as RedisClient
})

afterAll(() => {
  raw?.disconnect()
})

describe.skipIf(!reachable)('counting failed attempts in a real Redis', () => {
  it('lets the first five through and holds the sixth', async () => {
    const { account, ip } = pair()

    for (let attempt = 1; attempt <= ACCOUNT_ATTEMPTS; attempt += 1) {
      expect((await mayAttempt(redis, 'login', account, ip)).allowed, `before ${attempt}`).toBe(
        true,
      )
      await recordFailure(redis, 'login', account, ip)
    }

    const held = await mayAttempt(redis, 'login', account, ip)
    expect(held).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it('makes each further failure wait longer', async () => {
    const { account, ip } = pair()
    const waits: number[] = []

    for (let failure = 1; failure <= ACCOUNT_ATTEMPTS + 4; failure += 1) {
      await recordFailure(redis, 'login', account, ip)
      const attempt = await mayAttempt(redis, 'login', account, ip)
      waits.push(attempt.allowed ? 0 : attempt.retryAfterSeconds)
    }

    expect(waits).toEqual([0, 0, 0, 0, 60, 120, 240, 480, 900])
  })

  it('counts the address apart from the account', async () => {
    const { ip } = pair()

    for (let attempt = 1; attempt <= IP_ATTEMPTS + 1; attempt += 1) {
      await recordFailure(redis, 'login', `${run}_fresh${attempt}`, ip)
    }

    const other = await mayAttempt(redis, 'login', `${run}_never-tried`, ip)
    expect(other.allowed).toBe(false)
  })

  it('forgets the account after a login that worked, and not the address', async () => {
    const { account, ip } = pair()

    for (let attempt = 1; attempt <= ACCOUNT_ATTEMPTS + 1; attempt += 1) {
      await recordFailure(redis, 'login', account, ip)
    }
    await forgetFailures(redis, 'login', account)

    expect((await mayAttempt(redis, 'login', account, ip)).allowed).toBe(true)
    expect(await raw.get(limitKey('login', 'ip', ip))).toBe(String(ACCOUNT_ATTEMPTS + 1))
  })

  it('counts the window from the first failure, not from each one', async () => {
    const { account, ip } = pair()
    await recordFailure(redis, 'login', account, ip)

    const ttl = await raw.ttl(limitKey('login', 'account', account))
    expect(ttl).toBeGreaterThan(ATTEMPT_WINDOW_SECONDS - 10)
    expect(ttl).toBeLessThanOrEqual(ATTEMPT_WINDOW_SECONDS)
  })
})

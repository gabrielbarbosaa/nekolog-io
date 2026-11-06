import { nodeRedis, type RedisClient } from '@nekolog-io/adapters'
import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateCode } from './codes.ts'
import {
  codeKey,
  cooldownKey,
  issueCode,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_HOUR,
  type OtpStore,
  verifyCode,
} from './otp.ts'

const URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379'
const SECRET = 'a-secret-for-the-codes'

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
    `\nSkipping the OTP integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

let raw: Redis
let store: OtpStore
const run = `otp${process.pid}`
let seed = 0

function account(): string {
  seed += 1
  return `${run}:${seed}`
}

beforeAll(() => {
  raw = new Redis(URL)
  store = { redis: nodeRedis(raw) as RedisClient, secret: SECRET }
})

afterAll(() => {
  raw?.disconnect()
})

async function issuedFor(id: string, challenge: string): Promise<string> {
  const issued = await issueCode(store, 'login', id, challenge)
  if (issued.outcome !== 'issued') {
    throw new Error(`expected a code, got ${issued.outcome}`)
  }
  return issued.code
}

describe.skipIf(!reachable)('a code against a real Redis', () => {
  it('is accepted once and never again', async () => {
    const id = account()
    const code = await issuedFor(id, 'browser-a')

    expect(await verifyCode(store, 'login', id, 'browser-a', code)).toBe('accepted')
    expect(await verifyCode(store, 'login', id, 'browser-a', code)).toBe('expired')
  })

  it('is refused in another browser, and the right browser still works', async () => {
    const id = account()
    const code = await issuedFor(id, 'browser-a')

    expect(await verifyCode(store, 'login', id, 'browser-b', code)).toBe('expired')
    expect(await verifyCode(store, 'login', id, 'browser-a', code)).toBe('accepted')
  })

  it('ends the attempt on the fifth wrong code, before a sixth is possible', async () => {
    const id = account()
    const code = await issuedFor(id, 'browser-a')
    const wrong = generateCode() === code ? generateCode() : generateCode()

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(await verifyCode(store, 'login', id, 'browser-a', wrong), `attempt ${attempt}`).toBe(
        'wrong',
      )
    }

    expect(await verifyCode(store, 'login', id, 'browser-a', wrong)).toBe('exhausted')
    expect(await verifyCode(store, 'login', id, 'browser-a', code)).toBe('expired')
  })

  it('expires for real, by the TTL the script sets', async () => {
    const id = account()
    const code = await issuedFor(id, 'browser-a')

    expect(await raw.ttl(codeKey('login', id))).toBeGreaterThan(0)
    await raw.expire(codeKey('login', id), 1)
    await new Promise((resolve) => setTimeout(resolve, 1_200))

    expect(await verifyCode(store, 'login', id, 'browser-a', code)).toBe('expired')
  })

  it('makes a new code invalidate the one before it', async () => {
    const id = account()
    const first = await issuedFor(id, 'browser-a')
    await raw.del(cooldownKey('login', id))
    const second = await issuedFor(id, 'browser-a')

    expect(await verifyCode(store, 'login', id, 'browser-a', first)).toBe('wrong')
    expect(await verifyCode(store, 'login', id, 'browser-a', second)).toBe('accepted')
  })

  it('refuses a second send inside the cooldown', async () => {
    const id = account()
    await issuedFor(id, 'browser-a')

    expect((await issueCode(store, 'login', id, 'browser-a')).outcome).toBe('cooling-down')
  })

  it('refuses the sixth send within the hour', async () => {
    const id = account()

    for (let send = 1; send <= MAX_SENDS_PER_HOUR; send += 1) {
      await raw.del(cooldownKey('login', id))
      expect((await issueCode(store, 'login', id, 'browser-a')).outcome, `send ${send}`).toBe(
        'issued',
      )
    }

    await raw.del(cooldownKey('login', id))
    expect((await issueCode(store, 'login', id, 'browser-a')).outcome).toBe('too-many-sends')
  })

  it('counts the hour from the first send, not from each one', async () => {
    const id = account()
    await issuedFor(id, 'browser-a')

    expect(await raw.ttl(`otp:sends:login:${id}`)).toBeGreaterThan(3_500)
  })
})

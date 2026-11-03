import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RedisClient } from '../src/index.ts'
import { nodeRedis, prefixedRedis } from '../src/index.ts'

const URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379'

const ISSUE_OTP = `
if not redis.call('SET', KEYS[2], 1, 'NX', 'EX', ARGV[4]) then return -1 end
local sends = redis.call('INCR', KEYS[3])
if sends == 1 then redis.call('EXPIRE', KEYS[3], 3600) end
if sends > tonumber(ARGV[5]) then return -2 end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'challenge', ARGV[1], 'code', ARGV[2], 'attempts', 0)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`

const VERIFY_OTP = `
local d = redis.call('HMGET', KEYS[1], 'challenge', 'code')
if not d[1] or d[1] ~= ARGV[1] then return 0 end
if d[2] == ARGV[2] then redis.call('DEL', KEYS[1]) return 1 end
if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1]) return -2
end
return -1
`

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
    `\nSkipping Redis integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

let raw: Redis
let redis: RedisClient
const run = `t${process.pid}`
let seed = 0

function name(): string {
  seed += 1
  return `${run}:${seed}`
}

beforeAll(async () => {
  raw = new Redis(URL)
  redis = nodeRedis(raw)
})

afterAll(async () => {
  if (raw !== undefined) {
    const keys = await raw.keys(`*${run}*`)
    if (keys.length > 0) {
      await raw.del(...keys)
    }
    raw.disconnect()
  }
})

describe.skipIf(!reachable)('the client against a real Redis', () => {
  it('reads back what it wrote, and nothing for what it did not', async () => {
    const key = name()

    expect(await redis.get(key)).toBeNull()
    await redis.set(key, 'hello')
    expect(await redis.get(key)).toBe('hello')
    await redis.del(key)
    expect(await redis.get(key)).toBeNull()
  })

  it('lets a value expire on its own, which is what makes codes temporary', async () => {
    const key = name()

    await redis.set(key, 'code', { exSeconds: 100 })
    expect(await raw.ttl(key)).toBeGreaterThan(0)
  })

  it('counts and reads hashes the way the OTP scripts expect', async () => {
    const key = name()

    await redis.hset(key, { challenge: 'c1', code: 'h1', attempts: '0' })
    expect(await redis.hmget(key, ['challenge', 'code', 'missing'])).toEqual(['c1', 'h1', null])
    expect(await redis.hincrby(key, 'attempts', 1)).toBe(1)
  })
})

describe.skipIf(!reachable)('the OTP scripts from the plan, run by hash', () => {
  function keysFor(id: string): string[] {
    return [`otp:login:${id}`, `otp:cooldown:login:${id}`, `otp:sends:login:${id}`]
  }

  it('issues a code, then refuses a second one while the cooldown holds', async () => {
    const keys = keysFor(name())

    expect(await redis.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '60', '5'])).toBe(1)
    expect(await redis.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '60', '5'])).toBe(-1)
  })

  it('accepts the right code once and refuses it afterwards', async () => {
    const keys = keysFor(name())
    await redis.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '1', '5'])

    expect(await redis.eval(VERIFY_OTP, [keys[0] ?? ''], ['challenge', 'hash', '5'])).toBe(1)
    expect(await redis.eval(VERIFY_OTP, [keys[0] ?? ''], ['challenge', 'hash', '5'])).toBe(0)
  })

  it('refuses a code issued for another browser', async () => {
    const keys = keysFor(name())
    await redis.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '1', '5'])

    expect(await redis.eval(VERIFY_OTP, [keys[0] ?? ''], ['another', 'hash', '5'])).toBe(0)
  })

  it('throws the code away once the attempts run out', async () => {
    const keys = keysFor(name())
    await redis.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '1', '5'])

    expect(await redis.eval(VERIFY_OTP, [keys[0] ?? ''], ['challenge', 'wrong', '2'])).toBe(-1)
    expect(await redis.eval(VERIFY_OTP, [keys[0] ?? ''], ['challenge', 'wrong', '2'])).toBe(-2)
    expect(await redis.eval(VERIFY_OTP, [keys[0] ?? ''], ['challenge', 'hash', '2'])).toBe(0)
  })

  it('runs the second call without sending the script again', async () => {
    const before = await raw.info('commandstats')
    const keys = keysFor(name())

    await redis.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '1', '5'])
    await redis.eval(ISSUE_OTP, keysFor(name()), ['challenge', 'hash', '300', '1', '5'])

    const after = await raw.info('commandstats')
    expect(callsOf(after, 'evalsha') - callsOf(before, 'evalsha')).toBe(2)
    expect(callsOf(after, 'eval') - callsOf(before, 'eval')).toBe(0)
  })

  function callsOf(info: string, command: string): number {
    const found = new RegExp(`cmdstat_${command}:calls=(\\d+)`).exec(info)
    return found === null ? 0 : Number(found[1])
  }
})

describe.skipIf(!reachable)('two environments on one Redis', () => {
  it('never read each other, even with the same key name', async () => {
    const key = name()
    const dev = prefixedRedis(redis, 'dev')
    const prod = prefixedRedis(redis, 'prod')

    await dev.set(key, 'from dev')
    await prod.set(key, 'from prod')

    expect(await dev.get(key)).toBe('from dev')
    expect(await prod.get(key)).toBe('from prod')
  })

  it('keeps a script in its own environment too', async () => {
    const key = name()
    const keys = [`otp:login:${key}`, `otp:cooldown:login:${key}`, `otp:sends:login:${key}`]
    const dev = prefixedRedis(redis, 'dev')
    const prod = prefixedRedis(redis, 'prod')

    expect(await dev.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '60', '5'])).toBe(1)
    expect(await prod.eval(ISSUE_OTP, keys, ['challenge', 'hash', '300', '60', '5'])).toBe(1)
  })
})

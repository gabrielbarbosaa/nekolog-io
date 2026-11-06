import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { RedisClient } from '@nekolog-io/adapters'
import { describe, expect, it, vi } from 'vitest'
import { hashCode } from './codes.ts'
import {
  CODE_TTL_SECONDS,
  codeKey,
  cooldownKey,
  issueCode,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_HOUR,
  RESEND_COOLDOWN_SECONDS,
  SENDS_WINDOW_SECONDS,
  sendsKey,
  verifyCode,
} from './otp.ts'
import { ISSUE_OTP, VERIFY_OTP } from './scripts.ts'

const SECRET = 'a-secret-for-the-codes'
const ADAPTER_FIXTURE = fileURLToPath(
  new URL('../../../packages/adapters/tests/redis.integration.test.ts', import.meta.url),
)

function redisAnswering(answer: number) {
  const eval_ = vi.fn(async () => answer)
  return {
    eval: eval_,
    store: { redis: { eval: eval_ } as unknown as RedisClient, secret: SECRET },
  }
}

describe('the numbers the plan writes down', () => {
  it('are the ones the module uses', () => {
    expect(CODE_TTL_SECONDS).toBe(600)
    expect(MAX_ATTEMPTS).toBe(5)
    expect(RESEND_COOLDOWN_SECONDS).toBe(60)
    expect(MAX_SENDS_PER_HOUR).toBe(5)
    expect(SENDS_WINDOW_SECONDS).toBe(3600)
  })

  it('names the keys section 11.7 lists', () => {
    expect(codeKey('login', 'usr_1')).toBe('otp:login:usr_1')
    expect(cooldownKey('login', 'usr_1')).toBe('otp:cooldown:login:usr_1')
    expect(sendsKey('login', 'usr_1')).toBe('otp:sends:login:usr_1')
  })
})

describe('what reaches Redis', () => {
  it('is the hash of the code, never the code', async () => {
    const { eval: ran, store } = redisAnswering(1)
    const issued = await issueCode(store, 'login', 'usr_1', 'challenge')

    expect(issued.outcome).toBe('issued')
    const [, , args] = ran.mock.calls[0] as unknown as [string, string[], string[]]
    const code = (issued as { code: string }).code

    expect(args).not.toContain(code)
    expect(args[1]).toBe(hashCode(SECRET, 'challenge', code))
  })

  it('carries the window as an argument, not baked into the script', async () => {
    const { eval: ran, store } = redisAnswering(1)
    await issueCode(store, 'login', 'usr_1', 'challenge')

    const [script, , args] = ran.mock.calls[0] as unknown as [string, string[], string[]]
    expect(args[5]).toBe(String(SENDS_WINDOW_SECONDS))
    expect(script).not.toContain('3600')
  })

  it('reads a typed code through the same normalisation', async () => {
    const { eval: ran, store } = redisAnswering(1)
    await verifyCode(store, 'login', 'usr_1', 'challenge', ' k7q-m2p ')

    const [, , args] = ran.mock.calls[0] as unknown as [string, string[], string[]]
    expect(args[1]).toBe(hashCode(SECRET, 'challenge', 'K7QM2P'))
  })
})

describe('turning the script answer into an outcome', () => {
  it.each([
    [1, 'issued'],
    [-1, 'cooling-down'],
    [-2, 'too-many-sends'],
  ])('reads %i from issue as %s', async (answer, outcome) => {
    const { store } = redisAnswering(answer)

    expect((await issueCode(store, 'login', 'usr_1', 'challenge')).outcome).toBe(outcome)
  })

  it.each([
    [1, 'accepted'],
    [0, 'expired'],
    [-1, 'wrong'],
    [-2, 'exhausted'],
  ])('reads %i from verify as %s', async (answer, outcome) => {
    const { store } = redisAnswering(answer)

    expect(await verifyCode(store, 'login', 'usr_1', 'challenge', 'K7QM2P')).toBe(outcome)
  })
})

describe('the copy of these scripts that the adapter tests carry', () => {
  const fixture = readFileSync(ADAPTER_FIXTURE, 'utf8')

  it('exists, so this test is not passing on a file that moved', () => {
    expect(fixture).toContain('ISSUE_OTP')
    expect(fixture).toContain('VERIFY_OTP')
  })

  it('is the verify script this module runs, line for line', () => {
    expect(fixture).toContain(VERIFY_OTP)
  })

  it('differs from the issue script only in the window, which is an argument here', () => {
    expect(fixture).toContain(ISSUE_OTP.replace('ARGV[6]', '3600'))
  })
})

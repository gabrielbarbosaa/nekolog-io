import type { RedisClient } from '@nekolog-io/adapters'
import { describe, expect, it, vi } from 'vitest'
import { finishLogin, type LoginDeps, resendCode, startLogin } from './login.ts'
import { hashPassword } from './password.ts'
import { ACCOUNT_ATTEMPTS } from './rate-limit.ts'
import { memoryRedis } from './testing/memory-redis.ts'
import type { SqlRunner } from './users.ts'

const PASSWORD = 'a password of a legal length'
const IP = '203.0.113.7'

async function depsWith(rows: ReadonlyArray<Record<string, unknown>>): Promise<{
  deps: LoginDeps
  run: ReturnType<typeof vi.fn>
}> {
  const run = vi.fn(async () => rows)
  return {
    run,
    deps: { run: run as unknown as SqlRunner, redis: memoryRedis(), otpSecret: 'secret' },
  }
}

async function anAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr_1',
    email: 'someone@acme.test',
    name: 'Someone',
    password_hash: await hashPassword(PASSWORD),
    email_verified_at: new Date(),
    suspended_at: null,
    locale: 'en',
    timezone: 'UTC',
    ...overrides,
  }
}

describe('starting a login', () => {
  it('sends a code when the password is right', async () => {
    const { deps } = await depsWith([await anAccount()])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })

    expect(started.outcome).toBe('code-sent')
  })

  it('refuses a wrong password', async () => {
    const { deps } = await depsWith([await anAccount()])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: 'wrong',
      ip: IP,
    })

    expect(started.outcome).toBe('refused')
  })

  it('answers the same for an address with no account', async () => {
    const { deps } = await depsWith([])
    const started = await startLogin(deps, {
      email: 'nobody@acme.test',
      password: PASSWORD,
      ip: IP,
    })

    expect(started.outcome).toBe('refused')
  })

  it('still pays for an argon2 verification when there is no account', async () => {
    const { deps } = await depsWith([])

    const began = performance.now()
    await startLogin(deps, { email: 'nobody@acme.test', password: PASSWORD, ip: IP })
    const spent = performance.now() - began

    expect(
      spent,
      'an unknown address came back too fast to have verified anything, which is how ' +
        'someone learns the address is unknown',
    ).toBeGreaterThan(5)
  })

  it('takes a comparable time whether the account exists or not', async () => {
    const known = await depsWith([await anAccount()])
    const unknown = await depsWith([])

    const time = async (deps: LoginDeps, email: string): Promise<number> => {
      const began = performance.now()
      await startLogin(deps, { email, password: 'not the password', ip: IP })
      return performance.now() - began
    }

    const withAccount = await time(known.deps, 'someone@acme.test')
    const without = await time(unknown.deps, 'nobody@acme.test')
    const ratio = Math.max(withAccount, without) / Math.min(withAccount, without)

    expect(ratio, `${withAccount.toFixed(1)}ms against ${without.toFixed(1)}ms`).toBeLessThan(4)
  })

  it('looks the address up in lowercase, whatever was typed', async () => {
    const { deps, run } = await depsWith([await anAccount()])
    await startLogin(deps, { email: '  SomeOne@Acme.Test ', password: PASSWORD, ip: IP })

    expect(run.mock.calls[0]?.[1]).toEqual(['someone@acme.test'])
  })

  it('refuses an account whose e-mail was never confirmed', async () => {
    const { deps } = await depsWith([await anAccount({ email_verified_at: null })])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })

    expect(started.outcome).toBe('refused')
  })

  it('refuses a suspended account', async () => {
    const { deps } = await depsWith([await anAccount({ suspended_at: new Date() })])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })

    expect(started.outcome).toBe('refused')
  })

  it('holds the account back once the failures add up', async () => {
    const { deps } = await depsWith([await anAccount()])

    for (let attempt = 1; attempt <= ACCOUNT_ATTEMPTS; attempt += 1) {
      await startLogin(deps, { email: 'someone@acme.test', password: 'wrong', ip: IP })
    }

    const held = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })
    expect(held).toEqual({ outcome: 'slow-down', retryAfterSeconds: 60 })
  })

  it('forgets the failures once the password is right', async () => {
    const { deps } = await depsWith([await anAccount()])

    for (let attempt = 1; attempt < ACCOUNT_ATTEMPTS; attempt += 1) {
      await startLogin(deps, { email: 'someone@acme.test', password: 'wrong', ip: IP })
    }
    expect(
      (await startLogin(deps, { email: 'someone@acme.test', password: PASSWORD, ip: IP })).outcome,
    ).toBe('code-sent')

    for (let attempt = 1; attempt < ACCOUNT_ATTEMPTS; attempt += 1) {
      await startLogin(deps, { email: 'someone@acme.test', password: 'wrong', ip: IP })
    }
    const stillTrying = await startLogin(deps, {
      email: 'someone@acme.test',
      password: 'wrong',
      ip: IP,
    })
    expect(stillTrying.outcome).toBe('refused')
  })
})

describe('finishing a login', () => {
  it('creates a session when the code is right', async () => {
    const { deps } = await depsWith([await anAccount()])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })
    if (started.outcome !== 'code-sent') {
      throw new Error('expected a code')
    }

    const finished = await finishLogin(deps, {
      userId: started.account.id,
      challenge: started.challenge,
      code: started.code,
      remember: true,
      device: 'Firefox',
      country: 'BR',
    })

    expect(finished.outcome).toBe('signed-in')
  })

  it('refuses a code from another browser as if it had expired', async () => {
    const { deps } = await depsWith([await anAccount()])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })
    if (started.outcome !== 'code-sent') {
      throw new Error('expected a code')
    }

    const finished = await finishLogin(deps, {
      userId: started.account.id,
      challenge: 'another-browser',
      code: started.code,
      remember: true,
      device: 'Firefox',
      country: 'BR',
    })

    expect(finished.outcome).toBe('start-again')
  })

  it('tells a wrong code apart from one that is gone', async () => {
    const { deps } = await depsWith([await anAccount()])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })
    if (started.outcome !== 'code-sent') {
      throw new Error('expected a code')
    }

    const wrong = await finishLogin(deps, {
      userId: started.account.id,
      challenge: started.challenge,
      code: 'ZZZZZZ',
      remember: true,
      device: 'Firefox',
      country: 'BR',
    })

    expect(wrong.outcome).toBe('wrong-code')
  })
})

describe('asking for the code again', () => {
  it('waits out the cooldown rather than sending another', async () => {
    const { deps } = await depsWith([await anAccount()])
    const started = await startLogin(deps, {
      email: 'someone@acme.test',
      password: PASSWORD,
      ip: IP,
    })
    if (started.outcome !== 'code-sent') {
      throw new Error('expected a code')
    }

    expect(await resendCode(deps, started.account.id, started.challenge)).toEqual({
      outcome: 'wait',
    })
  })
})

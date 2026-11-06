import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { hashInviteToken, newInviteToken } from './invites.ts'
import type { LoginDeps } from './login.ts'
import {
  MAX_NAME_LENGTH,
  MEMBERSHIP_ID_PREFIX,
  newId,
  readName,
  signUp,
  USER_ID_PREFIX,
} from './signup.ts'
import { memoryRedis } from './testing/memory-redis.ts'
import type { SqlRunner } from './users.ts'

const TOKEN = 'an-invite-token'
const PASSWORD = 'a password of a legal length'

const OPEN_INVITE = {
  id: 'inv_1',
  organization_id: 'org_1',
  email: 'invited@acme.test',
  role: 'member',
}

function depsThatAnswer(
  rows: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>,
  breach: 'clean' | 'breached' = 'clean',
): { deps: LoginDeps; send: ReturnType<typeof vi.fn> } {
  const queue = [...rows]
  const suffix = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase().slice(5)
  const send = vi.fn(
    async () => new Response(breach === 'breached' ? `${suffix}:1\n` : 'AAAA:1\n', { status: 200 }),
  )

  return {
    send,
    deps: {
      run: (async () => queue.shift() ?? []) as unknown as SqlRunner,
      redis: memoryRedis(),
      otpSecret: 'secret',
      pwned: { fetch: send as unknown as typeof fetch },
    },
  }
}

describe('the invite token', () => {
  it('is long enough that nobody guesses one', () => {
    expect(Buffer.from(newInviteToken(), 'base64url')).toHaveLength(32)
  })

  it('is safe in a URL, because it arrives in a link', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(newInviteToken()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('is stored as a hash, so the database never holds the link', () => {
    const token = newInviteToken()
    const stored = hashInviteToken(token)

    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).not.toContain(token)
  })

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 500 }, newInviteToken)).size).toBe(500)
  })
})

describe('the ids this step mints', () => {
  it('match the shape the check constraints demand', () => {
    for (const prefix of [USER_ID_PREFIX, MEMBERSHIP_ID_PREFIX]) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        expect(newId(prefix), prefix).toMatch(new RegExp(`^${prefix}[0-9A-HJKMNP-TV-Z]{26}$`))
      }
    }
  })

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 500 }, () => newId(USER_ID_PREFIX))).size).toBe(500)
  })
})

describe('the name someone types', () => {
  it('loses the spaces around it and the doubled ones inside', () => {
    expect(readName('  Ana   Maria  ')).toBe('Ana Maria')
  })

  it('refuses a blank one and one past the limit', () => {
    expect(readName('')).toBeUndefined()
    expect(readName('   ')).toBeUndefined()
    expect(readName('a'.repeat(MAX_NAME_LENGTH + 1))).toBeUndefined()
    expect(readName('a'.repeat(MAX_NAME_LENGTH))).toBe('a'.repeat(MAX_NAME_LENGTH))
  })

  it('keeps the accents and the letters of a real name', () => {
    expect(readName('José Antônio Gonçalves')).toBe('José Antônio Gonçalves')
  })
})

describe('signing up against an invite', () => {
  it('refuses when no open invite answers to the token', async () => {
    const { deps } = depsThatAnswer([[]])

    expect(
      await signUp(deps, { token: TOKEN, name: 'Ana', password: PASSWORD, locale: 'en' }),
    ).toEqual({ outcome: 'no-invite' })
  })

  it('refuses a blank name before touching the password', async () => {
    const { deps, send } = depsThatAnswer([[OPEN_INVITE]])

    expect(
      await signUp(deps, { token: TOKEN, name: '   ', password: PASSWORD, locale: 'en' }),
    ).toEqual({ outcome: 'bad-name' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a password below the minimum, with the reason', async () => {
    const { deps } = depsThatAnswer([[OPEN_INVITE]])

    expect(
      await signUp(deps, { token: TOKEN, name: 'Ana', password: 'short', locale: 'en' }),
    ).toEqual({ outcome: 'bad-password', refusal: 'too-short' })
  })

  it('refuses a password the breach list knows', async () => {
    const { deps } = depsThatAnswer([[OPEN_INVITE]], 'breached')
    const breached = await signUp(deps, {
      token: TOKEN,
      name: 'Ana',
      password: PASSWORD,
      locale: 'en',
    })

    expect(breached.outcome).toBe('bad-password')
  })

  it('refuses when the invited address already has a confirmed account', async () => {
    const { deps } = depsThatAnswer([
      [OPEN_INVITE],
      [
        {
          id: 'usr_1',
          email: OPEN_INVITE.email,
          name: 'Already',
          password_hash: 'x',
          email_verified_at: new Date(),
          suspended_at: null,
          locale: 'en',
          timezone: 'UTC',
        },
      ],
    ])

    expect(
      await signUp(deps, { token: TOKEN, name: 'Ana', password: PASSWORD, locale: 'en' }),
    ).toEqual({ outcome: 'account-exists' })
  })

  it('creates the account and issues a code when everything is right', async () => {
    const { deps } = depsThatAnswer([[OPEN_INVITE], [], [{ id: 'usr_new' }]])
    const signed = await signUp(deps, {
      token: TOKEN,
      name: 'Ana',
      password: PASSWORD,
      locale: 'pt-BR',
    })

    expect(signed.outcome).toBe('code-sent')
    if (signed.outcome !== 'code-sent') {
      return
    }
    expect(signed.userId).toBe('usr_new')
    expect(signed.email).toBe(OPEN_INVITE.email)
    expect(signed.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(signed.challenge.length).toBeGreaterThan(20)
  })

  it('does not confirm the account while the code is still out', async () => {
    const { deps } = depsThatAnswer([[OPEN_INVITE], [], [{ id: 'usr_new' }]])
    const statements: string[] = []
    const watched: LoginDeps = {
      ...deps,
      run: (async (text, params) => {
        statements.push(text)
        return (await deps.run(text, params)) as never
      }) as SqlRunner,
    }

    await signUp(watched, { token: TOKEN, name: 'Ana', password: PASSWORD, locale: 'en' })

    expect(statements.join('\n')).not.toContain('email_verified_at =')
    expect(statements.join('\n')).not.toContain('memberships')
  })
})

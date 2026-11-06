import { describe, expect, it, vi } from 'vitest'
import { checkPassword, checkShape } from './policy.ts'
import { lookupBreach, PWNED_PREFIX_LENGTH, PWNED_RANGE_URL, suffixAppears } from './pwned.ts'

const PASSWORD = 'password123456'
const PASSWORD_SHA1 = '98A16C09B0759E63EF7DF53592724E8EEDDB953A'
const PREFIX = PASSWORD_SHA1.slice(0, PWNED_PREFIX_LENGTH)
const SUFFIX = PASSWORD_SHA1.slice(PWNED_PREFIX_LENGTH)

function answers(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status }))
}

describe('what leaves this machine', () => {
  it('is five characters of the hash and nothing else', async () => {
    const send = answers('')
    await lookupBreach(PASSWORD, { fetch: send as unknown as typeof fetch })

    const [url] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${PWNED_RANGE_URL}${PREFIX}`)
    expect(url).not.toContain(SUFFIX)
    expect(url).not.toContain(PASSWORD)
    expect(PREFIX).toHaveLength(5)
  })

  it('asks for padding, so the size of the answer says nothing', async () => {
    const send = answers('')
    await lookupBreach(PASSWORD, { fetch: send as unknown as typeof fetch })

    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Add-Padding']).toBe('true')
  })

  it('gives up rather than hanging on a slow answer', async () => {
    const send = answers('')
    await lookupBreach(PASSWORD, { fetch: send as unknown as typeof fetch })

    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('reading the range the API answers with', () => {
  it('finds the suffix among the many it returns', () => {
    expect(suffixAppears(`AAAA:1\n${SUFFIX}:42\nBBBB:3`, SUFFIX)).toBe(true)
  })

  it('tolerates the carriage returns the API actually sends', () => {
    expect(suffixAppears(`AAAA:1\r\n${SUFFIX}:42\r\n`, SUFFIX)).toBe(true)
  })

  it('does not match a suffix that merely contains it', () => {
    expect(suffixAppears(`${SUFFIX}00:42`, SUFFIX)).toBe(false)
    expect(suffixAppears(`00${SUFFIX}:42`, SUFFIX)).toBe(false)
  })

  it('reports a password in the list and one that is not', async () => {
    const breached = answers(`${SUFFIX}:12345`)
    const clean = answers('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1')

    expect(await lookupBreach(PASSWORD, { fetch: breached as unknown as typeof fetch })).toBe(
      'breached',
    )
    expect(await lookupBreach(PASSWORD, { fetch: clean as unknown as typeof fetch })).toBe('clean')
  })
})

describe('when the list cannot be reached', () => {
  it('answers unknown rather than pretending the password is clean', async () => {
    const dead = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })

    expect(await lookupBreach(PASSWORD, { fetch: dead as unknown as typeof fetch })).toBe('unknown')
  })

  it('answers unknown on a refusal from the API too', async () => {
    expect(
      await lookupBreach(PASSWORD, { fetch: answers('', 503) as unknown as typeof fetch }),
    ).toBe('unknown')
  })

  it('still lets the password through, and says the check did not run', async () => {
    const dead = vi.fn(async () => {
      throw new Error('offline')
    })
    const verdict = await checkPassword(PASSWORD, { fetch: dead as unknown as typeof fetch })

    expect(verdict).toEqual({ accepted: true, breachCheck: 'unknown' })
  })
})

describe('the policy around it', () => {
  it('refuses a password shorter than the minimum, before any network call', async () => {
    const send = answers('')
    const verdict = await checkPassword('short', { fetch: send as unknown as typeof fetch })

    expect(verdict).toEqual({ accepted: false, refusal: 'too-short' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses one past the maximum', () => {
    expect(checkShape('a'.repeat(129))).toBe('too-long')
    expect(checkShape('a'.repeat(128))).toBeUndefined()
  })

  it('counts characters, not bytes, so an emoji is one', () => {
    expect(checkShape('🔑'.repeat(12))).toBeUndefined()
    expect(checkShape('🔑'.repeat(11))).toBe('too-short')
  })

  it('refuses a breached password of a legal length', async () => {
    const breached = answers(`${SUFFIX}:12345`)

    expect(await checkPassword(PASSWORD, { fetch: breached as unknown as typeof fetch })).toEqual({
      accepted: false,
      refusal: 'breached',
    })
  })
})

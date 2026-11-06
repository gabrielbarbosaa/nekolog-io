import { describe, expect, it, vi } from 'vitest'
import { checkTurnstile, TURNSTILE_VERIFY_URL, turnstileIsOn } from './turnstile.ts'

const SECRET = '0x4AAAAAAA-a-secret'
const IP = '203.0.113.7'

function answers(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('whether the check runs at all', () => {
  it('is off with no secret, and on with one', () => {
    expect(turnstileIsOn(undefined)).toBe(false)
    expect(turnstileIsOn('')).toBe(false)
    expect(turnstileIsOn(SECRET)).toBe(true)
  })

  it('answers off without reaching the network when there is no secret', async () => {
    const send = answers({ success: true })

    expect(await checkTurnstile('a-token', IP, { secret: undefined, fetch: send as never })).toBe(
      'off',
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('runs as soon as a secret exists, which is the whole point of the switch', async () => {
    const send = answers({ success: true })
    await checkTurnstile('a-token', IP, { secret: SECRET, fetch: send as never })

    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls[0] as unknown as [string])[0]).toBe(TURNSTILE_VERIFY_URL)
  })
})

describe('what it sends and what it reads', () => {
  it('posts the secret, the token and the address, as a form', async () => {
    const send = answers({ success: true })
    await checkTurnstile('a-token', IP, { secret: SECRET, fetch: send as never })

    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    const sent = new URLSearchParams(init.body as string)

    expect(init.method).toBe('POST')
    expect(sent.get('secret')).toBe(SECRET)
    expect(sent.get('response')).toBe('a-token')
    expect(sent.get('remoteip')).toBe(IP)
  })

  it('gives up rather than hanging', async () => {
    const send = answers({ success: true })
    await checkTurnstile('a-token', IP, { secret: SECRET, fetch: send as never })

    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reads success as a human and anything else as a refusal', async () => {
    const human = answers({ success: true })
    const bot = answers({ success: false, 'error-codes': ['invalid-input-response'] })

    expect(await checkTurnstile('t', IP, { secret: SECRET, fetch: human as never })).toBe('human')
    expect(await checkTurnstile('t', IP, { secret: SECRET, fetch: bot as never })).toBe('refused')
  })

  it('refuses a success that is not exactly true', async () => {
    for (const body of [{ success: 'true' }, { success: 1 }, {}, null]) {
      const send = answers(body)
      expect(
        await checkTurnstile('t', IP, { secret: SECRET, fetch: send as never }),
        JSON.stringify(body),
      ).toBe('refused')
    }
  })
})

describe('when Cloudflare cannot be reached, it fails closed', () => {
  it('refuses on a network error', async () => {
    const dead = vi.fn(async () => {
      throw new Error('offline')
    })

    expect(await checkTurnstile('t', IP, { secret: SECRET, fetch: dead as never })).toBe('refused')
  })

  it('refuses on an error status', async () => {
    expect(
      await checkTurnstile('t', IP, { secret: SECRET, fetch: answers({}, 503) as never }),
    ).toBe('refused')
  })

  it('refuses a request that carried no token', async () => {
    const send = answers({ success: true })

    expect(await checkTurnstile(undefined, IP, { secret: SECRET, fetch: send as never })).toBe(
      'refused',
    )
    expect(send).not.toHaveBeenCalled()
  })
})

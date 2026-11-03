import { type FetchLike, memorySink } from '@nekolog-io/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BEACON_MAX_BYTES } from './beacon.ts'
import { clearUser, configureSession, PAGE_URL_ATTRIBUTE, setUser } from './context.ts'
import { SECRET_KEY_IN_A_BROWSER } from './keys.ts'
import { createLogger } from './logger.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

const PUBLIC_KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'
const SECRET_KEY = 'nekolog_sk_0123456789abcdef0123456789abcdef'

type Call = { url: string; init: Parameters<FetchLike>[1] }

function recordingFetch(): { send: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const send: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 202,
      headers: { get: () => null },
      text: () => Promise.resolve('{"accepted":1}'),
    }
  }
  return { send, calls }
}

function setLocation(href: string): void {
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(href)
}

beforeEach(() => {
  clearUser()
  configureSession({ storage: false })
  setLocation('https://shop.test/checkout?coupon=SECRET10#step=2')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('what a browser logger says about itself', () => {
  it('reports the browser runtime and this package', () => {
    const logger = createLogger({ sink: memorySink() })

    expect(logger.resource.runtime).toBe('browser')
    expect(logger.sdk).toEqual({ name: SDK_NAME, version: SDK_VERSION })
  })
})

describe('what every event carries', () => {
  it('has a session, without anyone asking for one', () => {
    const sink = memorySink()

    createLogger({ sink }).info('hello')

    expect(sink.events[0]?.session?.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps the same session across events', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.info('one')
    logger.info('two')

    expect(sink.events[0]?.session?.id).toBe(sink.events[1]?.session?.id)
  })

  it('names the page, without the query string', () => {
    const sink = memorySink()

    createLogger({ sink }).info('hello')

    expect(sink.events[0]?.attributes?.[PAGE_URL_ATTRIBUTE]).toBe('https://shop.test/checkout')
  })

  it('does not name the page when asked not to', () => {
    const sink = memorySink()

    createLogger({ sink, page: false }).info('hello')

    expect(sink.events[0]?.attributes?.[PAGE_URL_ATTRIBUTE]).toBeUndefined()
  })

  it('sends the whole address only when asked for it', () => {
    const sink = memorySink()

    createLogger({ sink, page: 'full' }).info('hello')

    expect(sink.events[0]?.attributes?.[PAGE_URL_ATTRIBUTE]).toContain('coupon=SECRET10')
  })
})

describe('who is using the page', () => {
  it('is nobody until someone says so', () => {
    const sink = memorySink()

    createLogger({ sink }).info('hello')

    expect(sink.events[0]?.session?.userId).toBeUndefined()
  })

  it('reaches events logged after the sign-in', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.info('before')
    setUser('u_42')
    logger.info('after')

    expect(sink.events[0]?.session?.userId).toBeUndefined()
    expect(sink.events[1]?.session?.userId).toBe('u_42')
  })

  it('goes away on sign-out', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })
    setUser('u_42')

    setUser(null)
    logger.info('after')

    expect(sink.events[0]?.session?.userId).toBeUndefined()
  })

  it.each(['', '   '])('treats %j as nobody', (value) => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    setUser(value)
    logger.info('hello')

    expect(sink.events[0]?.session?.userId).toBeUndefined()
  })
})

describe('the key', () => {
  it('sends nothing at all when a secret key is handed to a browser', async () => {
    const fetch = recordingFetch()
    const refusals: unknown[] = []

    const logger = createLogger({
      apiKey: SECRET_KEY,
      fetch: fetch.send,
      onError: (error) => refusals.push(error),
    })
    logger.error('boom')
    await logger.flush()

    expect(fetch.calls).toEqual([])
    expect(String(refusals[0])).toContain(SECRET_KEY_IN_A_BROWSER)
  })

  it('sends with a public key', async () => {
    const fetch = recordingFetch()

    const logger = createLogger({ apiKey: PUBLIC_KEY, fetch: fetch.send, sendBeacon: false })
    logger.error('boom')
    await logger.flush()

    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0]?.init.headers.Authorization).toBe(`Bearer ${PUBLIC_KEY}`)
  })

  it('takes the fetch from the transport options too, instead of ignoring it', async () => {
    const fetch = recordingFetch()

    const logger = createLogger({
      apiKey: PUBLIC_KEY,
      sendBeacon: false,
      offline: false,
      transport: { fetch: fetch.send },
    })
    logger.error('boom')
    await logger.flush()

    expect(fetch.calls).toHaveLength(1)
  })

  it('keeps batches small enough for the beacon to take them', async () => {
    const fetch = recordingFetch()

    const logger = createLogger({
      apiKey: PUBLIC_KEY,
      fetch: fetch.send,
      sendBeacon: false,
      transport: { maxBatchBytes: 10 * 1024 * 1024 },
    })
    for (let i = 0; i < 400; i++) {
      logger.error('x'.repeat(1_000))
    }
    await logger.flush()

    for (const call of fetch.calls) {
      expect(call.init.body.length).toBeLessThanOrEqual(BEACON_MAX_BYTES)
    }
    expect(fetch.calls.length).toBeGreaterThan(1)
  })
})

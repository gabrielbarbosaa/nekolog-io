import type { FetchLike } from '@nekolog-io/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { init } from './client.ts'
import { clearUser, PAGE_URL_ATTRIBUTE } from './context.ts'
import { ERROR_KIND_ATTRIBUTE, UNCAUGHT } from './handlers.ts'
import { markVisible } from './hidden.ts'

const PUBLIC_KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'

type Beacon = { url: string; body: string }

function stubbedFetch(): FetchLike {
  return async () => ({
    ok: true,
    status: 202,
    headers: { get: () => null },
    text: () => Promise.resolve('{"accepted":1}'),
  })
}

type Envelope = {
  resource: { runtime: string; service?: string }
  sdk: { name: string }
  events: Array<{
    message: string
    level: string
    session?: { id?: string; userId?: string }
    attributes?: Record<string, unknown>
  }>
}

describe('a page that starts the sdk and then crashes', () => {
  const beacons: Beacon[] = []
  let client: ReturnType<typeof init> | undefined

  beforeEach(() => {
    beacons.length = 0
    markVisible()
    clearUser()
    ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
      'https://shop.test/checkout?coupon=SECRET10',
    )
    client = init({
      apiKey: PUBLIC_KEY,
      service: 'checkout-web',
      session: { storage: false },
      fetch: stubbedFetch(),
      sendBeacon: (url, body) => {
        beacons.push({ url, body })
        return true
      },
    })
  })

  afterEach(async () => {
    await client?.close()
    client = undefined
  })

  it('sends the uncaught error by beacon when the page goes away', async () => {
    client?.setUser('u_42')

    window.dispatchEvent(
      new ErrorEvent('error', { error: new TypeError('card is undefined'), message: 'Uncaught' }),
    )
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(beacons).toHaveLength(1)

    const beacon = beacons[0] as Beacon
    const envelope = JSON.parse(beacon.body) as Envelope

    expect(beacon.url).toContain(`key=${PUBLIC_KEY}`)
    expect(envelope.resource.runtime).toBe('browser')
    expect(envelope.resource.service).toBe('checkout-web')
    expect(envelope.sdk.name).toBe('@nekolog-io/browser')
    expect(envelope.events).toHaveLength(1)
    expect(envelope.events[0]?.message).toBe('card is undefined')
    expect(envelope.events[0]?.attributes?.[ERROR_KIND_ATTRIBUTE]).toBe(UNCAUGHT)
    expect(envelope.events[0]?.session?.userId).toBe('u_42')
    expect(envelope.events[0]?.session?.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('never puts the coupon of the address into the payload', async () => {
    client?.logger.info('checkout opened')
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(beacons[0]?.body).not.toContain('SECRET10')

    const envelope = JSON.parse((beacons[0] as Beacon).body) as Envelope
    expect(envelope.events[0]?.attributes?.[PAGE_URL_ATTRIBUTE]).toBe('https://shop.test/checkout')
  })

  it('stops listening once it is closed', async () => {
    await client?.close()
    client = undefined

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after close') }))
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(beacons).toEqual([])
  })
})

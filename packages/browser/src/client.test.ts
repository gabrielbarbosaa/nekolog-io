import type { FetchLike } from '@nekolog-io/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BREADCRUMBS_ATTRIBUTE, type Breadcrumb } from './breadcrumbs.ts'
import { init } from './client.ts'
import { clearUser, PAGE_URL_ATTRIBUTE } from './context.ts'
import { ERROR_KIND_ATTRIBUTE, UNCAUGHT } from './handlers.ts'
import { markVisible } from './hidden.ts'
import { clearBreadcrumbs } from './trail.ts'

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
  const pageFetch = window.fetch
  let client: ReturnType<typeof init> | undefined

  beforeEach(() => {
    beacons.length = 0
    markVisible()
    clearUser()
    clearBreadcrumbs()
    document.body.innerHTML = ''
    window.fetch = (async () => ({ status: 201 })) as unknown as typeof window.fetch
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
    window.fetch = pageFetch
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

  it('carries what the person did before the crash', async () => {
    document.body.innerHTML = '<button id="pay">Pagar como Ada Lovelace</button>'
    const button = document.body.firstElementChild as HTMLElement

    button.click()
    await fetch('/api/orders?token=abc123', { method: 'POST' })
    window.history.pushState({}, '', '/checkout/confirm')
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('card is undefined') }))
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const envelope = JSON.parse((beacons[0] as Beacon).body) as Envelope
    const crumbs = JSON.parse(
      String(envelope.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]),
    ) as Breadcrumb[]

    expect(crumbs.map((entry) => entry.kind)).toEqual(['click', 'fetch', 'navigation'])
    expect(crumbs[0]?.message).toBe('button#pay')
    expect(crumbs[1]?.message).toBe('POST https://shop.test/api/orders')
    expect(crumbs[2]?.message).toBe('https://shop.test/checkout/confirm')
    expect(JSON.stringify(crumbs)).not.toContain('Ada')
    expect(JSON.stringify(crumbs)).not.toContain('abc123')
  })

  it('does not record the batch it is sending as a breadcrumb of its own', async () => {
    client?.logger.error('first')
    await client?.flush()
    client?.logger.error('second')
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const envelope = JSON.parse((beacons[0] as Beacon).body) as Envelope

    expect(envelope.events[0]?.attributes?.[BREADCRUMBS_ATTRIBUTE]).toBeUndefined()
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

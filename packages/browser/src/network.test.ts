import { DEFAULT_ENDPOINT } from '@nekolog-io/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createTrail, type Trail } from './breadcrumbs.ts'
import {
  DURATION_DATA_KEY,
  describeRequestUrl,
  ingestMatcher,
  installFetchBreadcrumbs,
  methodOf,
  STATUS_DATA_KEY,
  urlOf,
} from './network.ts'

const installed: Array<() => void> = []

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
})

type Target = { fetch?: unknown }

function watching(
  answer: (url: unknown) => Promise<unknown>,
  options: Parameters<typeof installFetchBreadcrumbs>[1] = {},
): { trail: Trail; target: Target } {
  const trail = createTrail()
  const target: Target = { fetch: (input: unknown) => answer(input) }
  let clock = 1_000
  installed.push(
    installFetchBreadcrumbs(trail, {
      target,
      href: () => 'https://shop.test/checkout',
      now: () => {
        clock += 5
        return clock
      },
      ...options,
    }),
  )
  return { trail, target }
}

const ok =
  (status = 200) =>
  () =>
    Promise.resolve({ status })

describe('reading the request', () => {
  it.each([
    ['a string', 'https://api.test/orders', 'https://api.test/orders'],
    ['a URL', new URL('https://api.test/orders'), 'https://api.test/orders'],
    ['a Request-shaped object', { url: 'https://api.test/orders' }, 'https://api.test/orders'],
  ])('reads the address out of %s', (_case, input, expected) => {
    expect(urlOf(input)).toBe(expected)
  })

  it('answers nothing for something it does not understand', () => {
    expect(urlOf(42)).toBeUndefined()
  })

  it.each([
    [undefined, undefined, 'GET'],
    [{ method: 'post' }, undefined, 'POST'],
    [undefined, { method: 'put' }, 'PUT'],
    [{ method: 'patch' }, { method: 'delete' }, 'DELETE'],
  ])('reads the method from %j and %j', (request, init, expected) => {
    expect(methodOf(request ?? 'https://api.test', init)).toBe(expected)
  })
})

describe('the address a breadcrumb shows', () => {
  it('resolves a relative path against the page', () => {
    expect(describeRequestUrl('/orders', 'path', 'https://shop.test/checkout')).toBe(
      'https://shop.test/orders',
    )
  })

  it('shows a relative path as one when there is no page', () => {
    expect(describeRequestUrl('/orders', 'path', undefined)).toBe('/orders')
  })

  it('does not mistake a lookalike host for the one it resolves against', () => {
    expect(describeRequestUrl('https://relative.invalid.evil.test/x', 'path', undefined)).toBe(
      'https://relative.invalid.evil.test/x',
    )
  })

  it('drops the query, where api keys and tokens travel', () => {
    expect(describeRequestUrl('/orders?token=abc123', 'path', 'https://shop.test/')).toBe(
      'https://shop.test/orders',
    )
  })

  it('shows nothing when addresses are turned off', () => {
    expect(describeRequestUrl('/orders', false, 'https://shop.test/')).toBeUndefined()
  })

  it('shows nothing for a scheme that is not a request to a server', () => {
    expect(describeRequestUrl('data:text/plain,hi', 'path', 'https://shop.test/')).toBeUndefined()
  })
})

describe('a request the page makes', () => {
  it('becomes a breadcrumb with the status and how long it took', async () => {
    const { trail, target } = watching(ok(201))

    await (target.fetch as typeof fetch)('https://api.test/orders', { method: 'POST' })

    expect(trail.list()).toEqual([
      {
        at: '1970-01-01T00:00:01.005Z',
        kind: 'fetch',
        message: 'POST https://api.test/orders',
        data: { [STATUS_DATA_KEY]: 201, [DURATION_DATA_KEY]: 5 },
      },
    ])
  })

  it('is marked when it never answered', async () => {
    const { trail, target } = watching(() => Promise.reject(new Error('offline')))

    await expect((target.fetch as typeof fetch)('https://api.test/orders')).rejects.toThrow(
      'offline',
    )

    expect(trail.list()[0]?.message).toBe('GET https://api.test/orders failed')
    expect(trail.list()[0]?.data?.[STATUS_DATA_KEY]).toBeUndefined()
  })

  it('gives the app exactly the answer it would have had', async () => {
    const body = { status: 200, marker: 'the real response' }
    const { target } = watching(() => Promise.resolve(body))

    await expect((target.fetch as typeof fetch)('https://api.test/orders')).resolves.toBe(body)
  })

  it('never records what was sent', async () => {
    const { trail, target } = watching(ok())

    await (target.fetch as typeof fetch)('https://api.test/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_live_secret' },
      body: JSON.stringify({ password: 'hunter2' }),
    })

    const recorded = JSON.stringify(trail.list())
    expect(recorded).not.toContain('hunter2')
    expect(recorded).not.toContain('sk_live_secret')
  })

  it('does not record the batch it is sending to us', async () => {
    const { trail, target } = watching(ok(202))

    await (target.fetch as typeof fetch)(`${DEFAULT_ENDPOINT}/v1/logs?key=nekolog_pk_abc`, {
      method: 'POST',
    })

    expect(trail.list()).toEqual([])
  })

  it('does not record our batch when the endpoint is a self-hosted one', async () => {
    const { trail, target } = watching(ok(202), { endpoint: 'https://logs.acme.test/' })

    await (target.fetch as typeof fetch)('https://logs.acme.test/v1/logs', { method: 'POST' })
    await (target.fetch as typeof fetch)('https://logs.acme.test/other', { method: 'POST' })

    expect(trail.list().map((entry) => entry.message)).toEqual([
      'POST https://logs.acme.test/other',
    ])
  })

  it('obeys a caller that wants a host left out', async () => {
    const { trail, target } = watching(ok(), { ignore: (url) => url.includes('analytics') })

    await (target.fetch as typeof fetch)('https://analytics.test/collect')
    await (target.fetch as typeof fetch)('https://api.test/orders')

    expect(trail.list()).toHaveLength(1)
  })
})

describe('the matcher for our own batches', () => {
  it('knows the default endpoint', () => {
    expect(ingestMatcher()(`${DEFAULT_ENDPOINT}/v1/logs`)).toBe(true)
  })

  it('does not mistake somebody else for us', () => {
    expect(ingestMatcher()('https://api.test/v1/logs')).toBe(false)
  })
})

describe('after uninstalling', () => {
  it('gives the page its own fetch back', async () => {
    const trail = createTrail()
    const original = () => Promise.resolve({ status: 200 })
    const target: Target = { fetch: original }

    const uninstall = installFetchBreadcrumbs(trail, { target })
    expect(target.fetch).not.toBe(original)

    uninstall()

    expect(target.fetch).toBe(original)
  })

  it('leaves a later patch of somebody else alone', () => {
    const trail = createTrail()
    const target: Target = { fetch: () => Promise.resolve({ status: 200 }) }

    const uninstall = installFetchBreadcrumbs(trail, { target })
    const theirs = () => Promise.resolve({ status: 418 })
    target.fetch = theirs
    uninstall()

    expect(target.fetch).toBe(theirs)
  })

  it('installs nothing where there is no fetch', () => {
    const trail = createTrail()
    const target: Target = {}

    expect(() => installFetchBreadcrumbs(trail, { target })()).not.toThrow()
    expect(target.fetch).toBeUndefined()
  })
})

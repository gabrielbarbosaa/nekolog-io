import { parseTraceparent, TRACEPARENT_HEADER } from '@nekolog-io/core'
import { afterEach, describe, expect, it } from 'vitest'
import { runWithContext } from './context.ts'
import { currentTrace, installTracePropagation, withTraceparent } from './trace.ts'

const TRACE = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' }
const HEADER = `00-${TRACE.traceId}-${TRACE.spanId}-01`

const installed: Array<() => void> = []

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
})

type Seen = { url: unknown; init: unknown }

function watching(options: Partial<Parameters<typeof installTracePropagation>[0]> = {}): {
  calls: Seen[]
  target: { fetch?: unknown }
} {
  const calls: Seen[] = []
  const target = {
    fetch: (url: unknown, init: unknown) => {
      calls.push({ url, init })
      return Promise.resolve({ status: 200 })
    },
  }
  installed.push(installTracePropagation({ targets: ['orders.internal'], target, ...options }))
  return { calls, target }
}

function headerOf(init: unknown): string | undefined {
  const headers = (init as { headers?: Record<string, string> } | undefined)?.headers
  return headers?.[TRACEPARENT_HEADER]
}

describe('the trace of the request being handled', () => {
  it('is whatever the surrounding context says', () => {
    runWithContext({ trace: TRACE }, () => {
      expect(currentTrace()).toEqual(TRACE)
    })
  })

  it('is nothing outside a request', () => {
    expect(currentTrace()).toBeUndefined()
  })
})

describe('which outgoing requests carry the header', () => {
  it('carries it to a service the caller named', async () => {
    const { calls, target } = watching()

    await runWithContext({ trace: TRACE }, () =>
      (target.fetch as typeof fetch)('https://orders.internal/v1/orders'),
    )

    expect(parseTraceparent(headerOf(calls[0]?.init))?.traceId).toBe(TRACE.traceId)
  })

  it('does not carry it anywhere else, because nothing is same origin on a server', async () => {
    const { calls, target } = watching()

    await runWithContext({ trace: TRACE }, () =>
      (target.fetch as typeof fetch)('https://api.stripe.test/v1/charges'),
    )

    expect(headerOf(calls[0]?.init)).toBeUndefined()
  })

  it('carries nothing when there is no request being handled', async () => {
    const { calls, target } = watching()

    await (target.fetch as typeof fetch)('https://orders.internal/v1/orders')

    expect(headerOf(calls[0]?.init)).toBeUndefined()
  })

  it('carries a child span, never the span of the request itself', async () => {
    const { calls, target } = watching()

    await runWithContext({ trace: TRACE }, () =>
      (target.fetch as typeof fetch)('https://orders.internal/v1/orders'),
    )

    const sent = parseTraceparent(headerOf(calls[0]?.init))
    expect(sent?.parentSpanId).not.toBe(TRACE.spanId)
  })

  it('gives a different span to each call', async () => {
    const { calls, target } = watching()

    await runWithContext({ trace: TRACE }, async () => {
      await (target.fetch as typeof fetch)('https://orders.internal/one')
      await (target.fetch as typeof fetch)('https://orders.internal/two')
    })

    expect(parseTraceparent(headerOf(calls[1]?.init))?.parentSpanId).not.toBe(
      parseTraceparent(headerOf(calls[0]?.init))?.parentSpanId,
    )
  })

  it('reads a Request object as well as a string', async () => {
    const { calls, target } = watching()

    await runWithContext({ trace: TRACE }, () =>
      (target.fetch as typeof fetch)(new Request('https://orders.internal/v1/orders')),
    )

    expect(headerOf(calls[0]?.init)).toBeDefined()
  })
})

describe('adding the header without breaking the request', () => {
  it('keeps the headers the caller set', () => {
    const [, init] = withTraceparent(['/api', { headers: { 'X-Thing': 'kept' } }], HEADER)

    expect(init).toEqual({ headers: { 'X-Thing': 'kept', [TRACEPARENT_HEADER]: HEADER } })
  })

  it('keeps a Headers object the caller built', () => {
    const [, init] = withTraceparent(
      ['/api', { headers: new Headers({ 'X-Thing': 'kept' }) }],
      HEADER,
    )

    const headers = (init as { headers: Headers }).headers
    expect(headers.get('X-Thing')).toBe('kept')
    expect(headers.get(TRACEPARENT_HEADER)).toBe(HEADER)
  })

  it('keeps the method and the body', () => {
    const [, init] = withTraceparent(['/api', { method: 'POST', body: 'x' }], HEADER)

    expect(init).toMatchObject({ method: 'POST', body: 'x' })
  })

  it('answers exactly what fetch answered', async () => {
    const body = { status: 200, marker: 'the real response' }
    const target: { fetch?: unknown } = { fetch: () => Promise.resolve(body) }
    installed.push(installTracePropagation({ targets: ['orders.internal'], target }))

    await expect((target.fetch as typeof fetch)('https://orders.internal/x')).resolves.toBe(body)
  })

  it('rethrows what fetch rejected', async () => {
    const target: { fetch?: unknown } = {
      fetch: () => Promise.reject(new TypeError('connection refused')),
    }
    installed.push(installTracePropagation({ targets: ['orders.internal'], target }))

    await expect((target.fetch as typeof fetch)('https://orders.internal/x')).rejects.toThrow(
      'connection refused',
    )
  })
})

describe('after uninstalling', () => {
  it('gives the process its own fetch back', () => {
    const original = () => Promise.resolve({ status: 200 })
    const target: { fetch?: unknown } = { fetch: original }

    const uninstall = installTracePropagation({ targets: ['orders.internal'], target })
    expect(target.fetch).not.toBe(original)

    uninstall()

    expect(target.fetch).toBe(original)
  })

  it('leaves a later patch of somebody else alone', () => {
    const target: { fetch?: unknown } = { fetch: () => Promise.resolve({ status: 200 }) }
    const uninstall = installTracePropagation({ targets: ['orders.internal'], target })

    const theirs = () => Promise.resolve({ status: 418 })
    target.fetch = theirs
    uninstall()

    expect(target.fetch).toBe(theirs)
  })

  it('installs nothing where there is no fetch', () => {
    const target: { fetch?: unknown } = {}

    expect(() => installTracePropagation({ targets: ['orders.internal'], target })()).not.toThrow()
    expect(target.fetch).toBeUndefined()
  })
})

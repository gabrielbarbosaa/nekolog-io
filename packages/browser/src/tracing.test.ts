import { memorySink, parseTraceparent, TRACEPARENT_HEADER } from '@nekolog-io/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTrail } from './breadcrumbs.ts'
import { configureSession } from './context.ts'
import { createLogger } from './logger.ts'
import { installFetchPatch, withTraceparent } from './network.ts'
import { currentTrace, nextSpan, resetTrace, traceMatcherFor } from './tracing.ts'

const PAGE = 'https://shop.test/checkout'
const HEADER = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

const installed: Array<() => void> = []

type Seen = { url: unknown; init: unknown }

function watching(options: Parameters<typeof installFetchPatch>[0] = {}): {
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
  installed.push(
    installFetchPatch({
      target,
      href: () => PAGE,
      trace: { matches: traceMatcherFor({}, () => PAGE), spanFor: nextSpan },
      ...options,
    }),
  )
  return { calls, target }
}

function headerOf(init: unknown): string | undefined {
  const headers = (init as { headers?: Record<string, string> } | undefined)?.headers
  return headers?.[TRACEPARENT_HEADER]
}

beforeEach(() => {
  resetTrace()
  configureSession({ storage: false })
})

afterEach(() => {
  for (const uninstall of installed.splice(0)) {
    uninstall()
  }
})

describe('the trace of a page', () => {
  it('is the same for every log on the page', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.info('one')
    logger.info('two')

    expect(sink.events[0]?.trace).toEqual(currentTrace())
    expect(sink.events[1]?.trace?.traceId).toBe(sink.events[0]?.trace?.traceId)
  })

  it('is a new one after a reset', () => {
    const before = currentTrace().traceId

    expect(resetTrace().traceId).not.toBe(before)
  })

  it('gives each request its own span under the same trace', () => {
    const first = nextSpan()
    const second = nextSpan()

    expect(first.traceId).toBe(currentTrace().traceId)
    expect(second.traceId).toBe(first.traceId)
    expect(second.spanId).not.toBe(first.spanId)
    expect(first.spanId).not.toBe(currentTrace().spanId)
  })
})

describe('which requests carry the header', () => {
  it('carries it to our own origin', async () => {
    const { calls, target } = watching()

    await (target.fetch as typeof fetch)('/api/orders')

    const sent = headerOf(calls[0]?.init)
    expect(parseTraceparent(sent)?.traceId).toBe(currentTrace().traceId)
  })

  it('does not carry it to somebody else', async () => {
    const { calls, target } = watching()

    await (target.fetch as typeof fetch)('https://analytics.example/collect')

    expect(headerOf(calls[0]?.init)).toBeUndefined()
  })

  it('carries it to a domain the caller named', async () => {
    const { calls, target } = watching({
      trace: {
        matches: traceMatcherFor({ targets: ['api.shop.test'] }, () => PAGE),
        spanFor: nextSpan,
      },
    })

    await (target.fetch as typeof fetch)('https://api.shop.test/orders')

    expect(headerOf(calls[0]?.init)).toBeDefined()
  })

  it('does not carry it to the ingestion, which has no use for it', async () => {
    const { calls, target } = watching({
      trace: {
        matches: () => true,
        spanFor: nextSpan,
      },
    })

    await (target.fetch as typeof fetch)('https://ingest.nekolog.io/v1/logs', { method: 'POST' })

    expect(headerOf(calls[0]?.init)).toBeUndefined()
  })

  it('sends a different span on every request', async () => {
    const { calls, target } = watching()

    await (target.fetch as typeof fetch)('/api/one')
    await (target.fetch as typeof fetch)('/api/two')

    const first = parseTraceparent(headerOf(calls[0]?.init))
    const second = parseTraceparent(headerOf(calls[1]?.init))

    expect(second?.traceId).toBe(first?.traceId)
    expect(second?.parentSpanId).not.toBe(first?.parentSpanId)
  })

  it('carries nothing when tracing was not asked for', async () => {
    const { calls, target } = watching({ trace: undefined })

    await (target.fetch as typeof fetch)('/api/orders')

    expect(headerOf(calls[0]?.init)).toBeUndefined()
  })
})

describe('adding the header without breaking the request', () => {
  it('keeps the headers the app already set', () => {
    const [, init] = withTraceparent(['/api', { headers: { 'X-Thing': 'kept' } }], HEADER)

    expect(init).toEqual({ headers: { 'X-Thing': 'kept', [TRACEPARENT_HEADER]: HEADER } })
  })

  it('keeps a Headers object the app already built', () => {
    const [, init] = withTraceparent(
      ['/api', { headers: new Headers({ 'X-Thing': 'kept' }) }],
      HEADER,
    )

    const headers = (init as { headers: Headers }).headers
    expect(headers.get('X-Thing')).toBe('kept')
    expect(headers.get(TRACEPARENT_HEADER)).toBe(HEADER)
  })

  it('keeps a list of pairs the app already built', () => {
    const [, init] = withTraceparent(['/api', { headers: [['X-Thing', 'kept']] }], HEADER)

    expect((init as { headers: string[][] }).headers).toEqual([
      ['X-Thing', 'kept'],
      [TRACEPARENT_HEADER, HEADER],
    ])
  })

  it('keeps the rest of what the app asked for', () => {
    const [, init] = withTraceparent(['/api', { method: 'POST', body: 'x' }], HEADER)

    expect(init).toMatchObject({ method: 'POST', body: 'x' })
  })

  it('keeps the headers of a Request the app built', () => {
    const request = new Request('https://shop.test/api', { headers: { 'X-Thing': 'kept' } })

    const [input] = withTraceparent([request], HEADER)

    expect((input as Request).headers.get('X-Thing')).toBe('kept')
    expect((input as Request).headers.get(TRACEPARENT_HEADER)).toBe(HEADER)
  })

  it('leaves the request alone rather than throwing', async () => {
    const { calls, target } = watching({
      trace: {
        matches: () => true,
        spanFor: () => {
          throw new Error('no trace today')
        },
      },
    })

    await (target.fetch as typeof fetch)('/api/orders')

    expect(calls).toHaveLength(1)
    expect(headerOf(calls[0]?.init)).toBeUndefined()
  })
})

describe('the breadcrumb and the header together', () => {
  it('both happen on one patch, not two', async () => {
    const trail = createTrail()
    const { calls, target } = watching({ trail })

    await (target.fetch as typeof fetch)('/api/orders')

    expect(trail.list()).toHaveLength(1)
    expect(headerOf(calls[0]?.init)).toBeDefined()
  })
})

import { describe, expect, it } from 'vitest'
import {
  childSpan,
  createTraceTargetMatcher,
  newSpanId,
  newTraceId,
  parseTraceparent,
  traceForRequest,
  traceparentOf,
} from './trace.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

describe('reading a traceparent', () => {
  it('reads the one from the specification', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`)).toEqual({
      traceId: TRACE_ID,
      parentSpanId: SPAN_ID,
      sampled: true,
    })
  })

  it('reads the sampled flag as the flag it is, not as the whole byte', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-03`)?.sampled).toBe(true)
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-02`)?.sampled).toBe(false)
  })

  it('accepts a version it has never heard of, as the specification demands', () => {
    expect(parseTraceparent(`cc-${TRACE_ID}-${SPAN_ID}-01`)?.traceId).toBe(TRACE_ID)
  })

  it.each([
    ['the forbidden version', `ff-${TRACE_ID}-${SPAN_ID}-01`],
    ['an all zero trace id', `00-${'0'.repeat(32)}-${SPAN_ID}-01`],
    ['an all zero span id', `00-${TRACE_ID}-${'0'.repeat(16)}-01`],
    ['a short trace id', `00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`],
    ['upper case hex', `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`],
    ['a missing field', `00-${TRACE_ID}-${SPAN_ID}`],
    ['an extra field', `00-${TRACE_ID}-${SPAN_ID}-01-extra`],
    ['nothing at all', ''],
    ['an injected newline', `00-${TRACE_ID}-${SPAN_ID}-01\r\nx-evil: 1`],
  ])('refuses %s', (_case, header) => {
    expect(parseTraceparent(header)).toBeUndefined()
  })

  it.each([undefined, null, 42, {}, []])('refuses %j', (header) => {
    expect(parseTraceparent(header)).toBeUndefined()
  })
})

describe('writing a traceparent', () => {
  it('writes what the specification asks for', () => {
    expect(traceparentOf({ traceId: TRACE_ID, spanId: SPAN_ID })).toBe(
      `00-${TRACE_ID}-${SPAN_ID}-01`,
    )
  })

  it('says so when the trace is not sampled', () => {
    expect(traceparentOf({ traceId: TRACE_ID, spanId: SPAN_ID }, false)).toBe(
      `00-${TRACE_ID}-${SPAN_ID}-00`,
    )
  })

  it('writes what it can read back', () => {
    const header = traceparentOf({ traceId: newTraceId(), spanId: newSpanId() })

    expect(parseTraceparent(header)).toBeDefined()
  })
})

describe('the trace of an incoming request', () => {
  it('continues the caller trace with a span of its own', () => {
    const made = traceForRequest(`00-${TRACE_ID}-${SPAN_ID}-01`)

    expect(made.trace.traceId).toBe(TRACE_ID)
    expect(made.trace.spanId).not.toBe(SPAN_ID)
    expect(made.parentSpanId).toBe(SPAN_ID)
    expect(made.sampled).toBe(true)
  })

  it('starts a new trace when nobody sent one', () => {
    const made = traceForRequest(undefined)

    expect(made.trace.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(made.parentSpanId).toBeUndefined()
    expect(made.sampled).toBe(true)
  })

  it('starts a new trace when what arrived was nonsense', () => {
    expect(traceForRequest('not a traceparent').trace.traceId).not.toBe(TRACE_ID)
  })

  it('carries a refusal to sample forward', () => {
    expect(traceForRequest(`00-${TRACE_ID}-${SPAN_ID}-00`).sampled).toBe(false)
  })
})

describe('identifiers', () => {
  it('are the right length', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('are not the same twice', () => {
    const seen = new Set(Array.from({ length: 1_000 }, () => newTraceId()))

    expect(seen.size).toBe(1_000)
  })

  it('a child keeps the trace and changes the span', () => {
    const child = childSpan({ traceId: TRACE_ID, spanId: SPAN_ID })

    expect(child.traceId).toBe(TRACE_ID)
    expect(child.spanId).not.toBe(SPAN_ID)
  })
})

describe('which addresses get the header', () => {
  const page = 'https://shop.test/checkout'

  it('sends it nowhere when nothing was configured', () => {
    const matches = createTraceTargetMatcher()

    expect(matches('https://api.shop.test/orders')).toBe(false)
    expect(matches('https://shop.test/orders')).toBe(false)
  })

  it('sends it to our own origin when asked to', () => {
    const matches = createTraceTargetMatcher({ sameOrigin: true, origin: page })

    expect(matches('https://shop.test/api/orders')).toBe(true)
    expect(matches('/api/orders')).toBe(true)
  })

  it('does not treat another port as the same origin', () => {
    const matches = createTraceTargetMatcher({ sameOrigin: true, origin: page })

    expect(matches('https://shop.test:8443/api/orders')).toBe(false)
  })

  it('does not treat plain http as the same origin', () => {
    const matches = createTraceTargetMatcher({ sameOrigin: true, origin: page })

    expect(matches('http://shop.test/api/orders')).toBe(false)
  })

  it('does not hand it to a host that merely starts the same', () => {
    const matches = createTraceTargetMatcher({ targets: ['api.shop.test'], origin: page })

    expect(matches('https://api.shop.test.evil.test/orders')).toBe(false)
    expect(matches('https://api.shop.test/orders')).toBe(true)
  })

  it('does not hand it to a subdomain unless the entry asks for one', () => {
    const strict = createTraceTargetMatcher({ targets: ['shop.test'], origin: page })
    const wide = createTraceTargetMatcher({ targets: ['.shop.test'], origin: page })

    expect(strict('https://api.shop.test/orders')).toBe(false)
    expect(wide('https://api.shop.test/orders')).toBe(true)
    expect(wide('https://shop.test/orders')).toBe(true)
    expect(wide('https://notshop.test/orders')).toBe(false)
  })

  it('honours a path on the entry', () => {
    const matches = createTraceTargetMatcher({ targets: ['https://shop.test/api'], origin: page })

    expect(matches('https://shop.test/api/orders')).toBe(true)
    expect(matches('https://shop.test/api')).toBe(true)
    expect(matches('https://shop.test/apikeys')).toBe(false)
    expect(matches('https://shop.test/other')).toBe(false)
  })

  it('honours a path on an entry that is only a host', () => {
    const matches = createTraceTargetMatcher({ targets: ['shop.test/api'], origin: page })

    expect(matches('https://shop.test/api/orders')).toBe(true)
    expect(matches('https://shop.test/api')).toBe(true)
    expect(matches('https://shop.test/apikeys')).toBe(false)
    expect(matches('https://shop.test/other')).toBe(false)
  })

  it('takes a regular expression when the caller wants one', () => {
    const matches = createTraceTargetMatcher({ targets: [/^https:\/\/[a-z]+\.shop\.test\//] })

    expect(matches('https://api.shop.test/orders')).toBe(true)
    expect(matches('https://api.other.test/orders')).toBe(false)
  })

  it.each(['data:text/plain,hi', 'javascript:alert(1)', 'ws://shop.test/socket'])(
    'never hands it to %j',
    (candidate) => {
      const matches = createTraceTargetMatcher({
        sameOrigin: true,
        origin: page,
        targets: [/.*/],
      })

      expect(matches(candidate)).toBe(false)
    },
  )

  it('refuses an address it cannot read', () => {
    const matches = createTraceTargetMatcher({ targets: [/.*/] })

    expect(matches('/relative/with/no/page')).toBe(false)
  })

  it('ignores an entry that is blank', () => {
    const matches = createTraceTargetMatcher({ targets: ['   ', ''], origin: page })

    expect(matches('https://shop.test/orders')).toBe(false)
  })
})

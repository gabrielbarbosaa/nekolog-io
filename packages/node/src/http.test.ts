import { parseTraceparent, TRACEPARENT_HEADER } from '@nekolog-io/core'
import { describe, expect, it } from 'vitest'
import {
  accessAttributes,
  accessMessage,
  DURATION_ATTRIBUTE,
  levelForStatus,
  MAX_REQUEST_ID_CHARS,
  METHOD_ATTRIBUTE,
  newRequestId,
  PARENT_SPAN_ATTRIBUTE,
  REQUEST_ID_ATTRIBUTE,
  REQUEST_ID_HEADER,
  ROUTE_ATTRIBUTE,
  requestIdFrom,
  STATUS_ATTRIBUTE,
  startRequest,
} from './http.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

describe('the request id', () => {
  it('is kept when the caller sent a sane one', () => {
    expect(requestIdFrom('req_7f3a-91', () => 'made-up')).toBe('req_7f3a-91')
  })

  it.each([
    ['nothing', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['only spaces', '   '],
    ['a header injection', 'abc\r\nx-evil: 1'],
    ['a script tag', '<script>alert(1)</script>'],
    ['a path', '../../etc/passwd'],
    ['one that is too long', 'a'.repeat(MAX_REQUEST_ID_CHARS + 1)],
  ])('is made up instead of trusting %s', (_case, header) => {
    expect(requestIdFrom(header, () => 'made-up')).toBe('made-up')
  })

  it('is hex when nobody sent one', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is not the same twice', () => {
    expect(new Set(Array.from({ length: 500 }, newRequestId)).size).toBe(500)
  })
})

describe('the level a status deserves', () => {
  it.each([
    [200, 'info'],
    [204, 'info'],
    [301, 'info'],
    [400, 'warn'],
    [404, 'warn'],
    [499, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('logs %i as %s', (status, level) => {
    expect(levelForStatus(status)).toBe(level)
  })

  it('treats a status it cannot read as an error, not as a success', () => {
    expect(levelForStatus(Number.NaN)).toBe('error')
  })
})

describe('starting a request', () => {
  it('continues the caller trace and answers with it', () => {
    const started = startRequest({
      traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
      requestId: 'req_1',
    })

    expect(started.trace.traceId).toBe(TRACE_ID)
    expect(started.trace.spanId).not.toBe(SPAN_ID)
    expect(started.context.attributes?.[PARENT_SPAN_ATTRIBUTE]).toBe(SPAN_ID)
    expect(parseTraceparent(started.headers[TRACEPARENT_HEADER])?.traceId).toBe(TRACE_ID)
    expect(started.headers[REQUEST_ID_HEADER]).toBe('req_1')
  })

  it('starts a trace of its own when nobody sent one', () => {
    const started = startRequest({})

    expect(started.trace.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(started.context.attributes?.[PARENT_SPAN_ATTRIBUTE]).toBeUndefined()
    expect(started.context.attributes?.[REQUEST_ID_ATTRIBUTE]).toBe(
      started.headers[REQUEST_ID_HEADER],
    )
  })

  it('carries a refusal to sample into the answer', () => {
    const started = startRequest({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-00` })

    expect(started.sampled).toBe(false)
    expect(started.headers[TRACEPARENT_HEADER]?.endsWith('-00')).toBe(true)
  })
})

describe('the access line', () => {
  const line = { method: 'GET', route: '/orders/:id', status: 200, durationMs: 12 }

  it('reads as a line', () => {
    expect(accessMessage(line)).toBe('GET /orders/:id 200')
  })

  it('carries the pieces as attributes too', () => {
    expect(accessAttributes(line)).toEqual({
      [METHOD_ATTRIBUTE]: 'GET',
      [ROUTE_ATTRIBUTE]: '/orders/:id',
      [STATUS_ATTRIBUTE]: 200,
      [DURATION_ATTRIBUTE]: 12,
    })
  })
})

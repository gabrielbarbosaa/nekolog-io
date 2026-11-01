import { describe, expect, it } from 'vitest'
import { parseTraceparent, traceForRequest, traceparentOf } from './trace.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

function counting(): (size: number) => Uint8Array {
  let call = 0
  return (size) => {
    call += 1
    return Uint8Array.from({ length: size }, () => call)
  }
}

describe('parsing a traceparent the caller sent', () => {
  it('reads the trace id, the parent span and the sampled flag', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`)).toEqual({
      traceId: TRACE_ID,
      parentSpanId: SPAN_ID,
      sampled: true,
    })
  })

  it('reads a flags byte that only sets other bits as not sampled', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-02`)?.sampled).toBe(false)
  })

  it.each([
    ['no header at all', undefined],
    ['a header that is not text', 42],
    ['an empty header', ''],
    ['too few fields', `00-${TRACE_ID}-${SPAN_ID}`],
    ['a short trace id', `00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`],
    ['a short span id', `00-${TRACE_ID}-${SPAN_ID.slice(1)}-01`],
    ['something that is not hex', `00-${'z'.repeat(32)}-${SPAN_ID}-01`],
    ['uppercase hex, which the w3c format forbids', `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`],
    ['the forbidden ff version', `ff-${TRACE_ID}-${SPAN_ID}-01`],
    ['an all-zero trace id', `00-${'0'.repeat(32)}-${SPAN_ID}-01`],
    ['an all-zero span id', `00-${TRACE_ID}-${'0'.repeat(16)}-01`],
    ['a header carrying a newline, which could forge a log line', `00-${TRACE_ID}\n-x-01`],
  ])('refuses %s', (_name, header) => {
    expect(parseTraceparent(header)).toBeUndefined()
  })
})

describe('the trace a request runs under', () => {
  it('keeps the caller trace id but mints its own span id', () => {
    const { trace, parentSpanId, sampled } = traceForRequest(
      `00-${TRACE_ID}-${SPAN_ID}-01`,
      counting(),
    )

    expect(trace.traceId).toBe(TRACE_ID)
    expect(trace.spanId).toBe('01'.repeat(8))
    expect(trace.spanId).not.toBe(SPAN_ID)
    expect(parentSpanId).toBe(SPAN_ID)
    expect(sampled).toBe(true)
  })

  it('starts a fresh trace when the caller sent nothing usable', () => {
    const { trace, parentSpanId, sampled } = traceForRequest('garbage', counting())

    expect(trace.spanId).toBe('01'.repeat(8))
    expect(trace.traceId).toBe('02'.repeat(16))
    expect(parentSpanId).toBeUndefined()
    expect(sampled).toBe(true)
  })

  it('gives every request its own span id', () => {
    const header = `00-${TRACE_ID}-${SPAN_ID}-01`
    const first = traceForRequest(header)
    const second = traceForRequest(header)

    expect(first.trace.traceId).toBe(second.trace.traceId)
    expect(first.trace.spanId).not.toBe(second.trace.spanId)
  })
})

describe('the traceparent handed downstream', () => {
  it('round trips through the parser', () => {
    const header = traceparentOf({ traceId: TRACE_ID, spanId: SPAN_ID }, true)

    expect(header).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`)
    expect(parseTraceparent(header)).toEqual({
      traceId: TRACE_ID,
      parentSpanId: SPAN_ID,
      sampled: true,
    })
  })

  it('says not sampled when the caller said so', () => {
    expect(traceparentOf({ traceId: TRACE_ID, spanId: SPAN_ID }, false)).toMatch(/-00$/)
  })
})

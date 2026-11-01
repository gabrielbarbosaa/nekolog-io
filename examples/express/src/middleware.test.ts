import { EventEmitter } from 'node:events'
import { currentContext, memorySink, runWithContext } from '@nekolog-io/node'
import { describe, expect, it } from 'vitest'
import { createExampleLogger } from './logger.ts'
import {
  levelForStatus,
  MAX_REQUEST_ID_CHARS,
  requestIdFrom,
  routeOf,
  withAccessLog,
} from './middleware.ts'

const fallback = () => 'generated'

describe('the request id the caller may supply', () => {
  it('is kept when it is short and plain', () => {
    expect(requestIdFrom('01JB-4Z.9:ab', fallback)).toBe('01JB-4Z.9:ab')
  })

  it('is trimmed', () => {
    expect(requestIdFrom('  abc  ', fallback)).toBe('abc')
  })

  it.each([
    ['nothing was sent', undefined],
    ['it is not text', 42],
    ['it is blank', '   '],
    ['it carries a newline that would forge a second log line', 'abc\nlevel=fatal'],
    ['it carries a space', 'a b'],
    ['it carries a quote that would break a json log line', 'a"b'],
    ['it carries a control character', 'a\u0000b'],
    ['it is longer than the ceiling', 'a'.repeat(MAX_REQUEST_ID_CHARS + 1)],
  ])('is replaced when %s', (_name, header) => {
    expect(requestIdFrom(header, fallback)).toBe('generated')
  })

  it('accepts one exactly at the ceiling', () => {
    const id = 'a'.repeat(MAX_REQUEST_ID_CHARS)

    expect(requestIdFrom(id, fallback)).toBe(id)
  })
})

describe('the level an access log line gets', () => {
  it.each([
    [200, 'info'],
    [204, 'info'],
    [301, 'info'],
    [400, 'warn'],
    [404, 'warn'],
    [429, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('is %s for status %s', (status, level) => {
    expect(levelForStatus(status)).toBe(level)
  })
})

describe('the route an access log line names', () => {
  it('is the matched pattern, not the path the caller chose', () => {
    const request = { baseUrl: '', route: { path: '/orders/:id' } }

    expect(routeOf(request as never)).toBe('/orders/:id')
  })

  it('includes the mount point of a router', () => {
    const request = { baseUrl: '/v1', route: { path: '/orders/:id' } }

    expect(routeOf(request as never)).toBe('/v1/orders/:id')
  })

  it('says unmatched when nothing matched, instead of echoing the url', () => {
    expect(routeOf({ baseUrl: '', route: undefined } as never)).toBe('unmatched')
  })
})

describe('the access line written when the response finishes', () => {
  const traceId = 'a'.repeat(32)
  const spanId = 'b'.repeat(16)

  function run() {
    const sink = memorySink()
    const logger = createExampleLogger({ sink, level: 'trace' })
    const response = Object.assign(new EventEmitter(), { statusCode: 201 })
    const request = { method: 'POST', baseUrl: '', route: { path: '/orders' } }

    runWithContext({ trace: { traceId, spanId }, attributes: { 'request.id': 'r_1' } }, () => {
      withAccessLog(logger)(request as never, response as never, () => undefined)
    })

    return { sink, response }
  }

  it('keeps the request context although finish fires outside it', () => {
    const { sink, response } = run()

    expect(currentContext()).toBeUndefined()
    response.emit('finish')

    expect(sink.events[0]?.trace).toEqual({ traceId, spanId })
    expect(sink.events[0]?.attributes).toMatchObject({ 'request.id': 'r_1', 'http.status': 201 })
  })

  it('writes exactly one line, however the response finishes', () => {
    const { sink, response } = run()

    response.emit('finish')

    expect(sink.events).toHaveLength(1)
    expect(sink.events[0]?.message).toBe('POST /orders 201')
  })
})

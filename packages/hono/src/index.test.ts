import { type LogEvent, memorySink, parseTraceparent, TRACEPARENT_HEADER } from '@nekolog-io/core'
import {
  createLogger,
  currentContext,
  DURATION_ATTRIBUTE,
  METHOD_ATTRIBUTE,
  REQUEST_ID_ATTRIBUTE,
  REQUEST_ID_HEADER,
  ROUTE_ATTRIBUTE,
  STATUS_ATTRIBUTE,
} from '@nekolog-io/node'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { nekolog, routeOf } from './index.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

function app(options: Parameters<typeof nekolog>[1] = {}): { hono: Hono; events: LogEvent[] } {
  const sink = memorySink()
  const logger = createLogger({ sink, level: 'trace' })
  const hono = new Hono()
  hono.use('*', nekolog(logger, options))
  hono.get('/orders/:id', (c) => {
    logger.info('handling the order')
    return c.json({ id: c.req.param('id') })
  })
  hono.get('/broken', () => {
    throw new Error('the handler gave up')
  })
  hono.get('/missing', (c) => c.json({}, 404))
  return { hono, events: sink.events }
}

describe('a request through the middleware', () => {
  it('is logged as an access line', async () => {
    const { hono, events } = app({ now: () => 1_000 })

    const response = await hono.request('/orders/ord_7')

    expect(response.status).toBe(200)
    const access = events[events.length - 1] as LogEvent
    expect(access.message).toBe('GET /orders/:id 200')
    expect(access.attributes?.[METHOD_ATTRIBUTE]).toBe('GET')
    expect(access.attributes?.[ROUTE_ATTRIBUTE]).toBe('/orders/:id')
    expect(access.attributes?.[STATUS_ATTRIBUTE]).toBe(200)
    expect(access.attributes?.[DURATION_ATTRIBUTE]).toBe(0)
  })

  it('answers with the trace and the request id', async () => {
    const { hono } = app()

    const response = await hono.request('/orders/ord_7', {
      headers: { [TRACEPARENT_HEADER]: `00-${TRACE_ID}-${SPAN_ID}-01` },
    })

    expect(parseTraceparent(response.headers.get(TRACEPARENT_HEADER))?.traceId).toBe(TRACE_ID)
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('keeps the request id the caller sent', async () => {
    const { hono } = app()

    const response = await hono.request('/orders/ord_7', {
      headers: { [REQUEST_ID_HEADER]: 'req_from_the_proxy' },
    })

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('req_from_the_proxy')
  })

  it('refuses a request id that could forge a header', async () => {
    const { hono } = app()

    const response = await hono.request('/orders/ord_7', {
      headers: { [REQUEST_ID_HEADER]: 'abc def' },
    })

    expect(response.headers.get(REQUEST_ID_HEADER)).not.toContain(' ')
  })

  it('puts the request id and the trace on what the handler logs', async () => {
    const { hono, events } = app()

    await hono.request('/orders/ord_7')

    const handled = events[0] as LogEvent
    expect(handled.message).toBe('handling the order')
    expect(handled.attributes?.[REQUEST_ID_ATTRIBUTE]).toBeDefined()
    expect(handled.trace?.traceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('gives the handler and the access line the same trace', async () => {
    const { hono, events } = app()

    await hono.request('/orders/ord_7')

    expect(events[1]?.trace?.traceId).toBe(events[0]?.trace?.traceId)
  })

  it('logs a 404 as a warning', async () => {
    const { hono, events } = app()

    await hono.request('/missing')

    expect(events[events.length - 1]?.level).toBe('warn')
  })

  it('logs a handler that threw as an error', async () => {
    const { hono, events } = app()

    await hono.request('/broken')

    expect(events[events.length - 1]?.level).toBe('error')
    expect(events[events.length - 1]?.attributes?.[STATUS_ATTRIBUTE]).toBe(500)
  })

  it('still answers when the access log is turned off', async () => {
    const { hono, events } = app({ accessLog: false })

    const response = await hono.request('/orders/ord_7')

    expect(response.status).toBe(200)
    expect(events).toHaveLength(1)
  })
})

describe('the route a line names', () => {
  it('is the pattern, not the address, so ids do not become routes', () => {
    expect(
      routeOf({
        req: {
          method: 'GET',
          path: '/orders/ord_7',
          routePath: '/orders/:id',
          header: () => undefined,
        },
        res: { status: 200 },
        header: () => undefined,
      }),
    ).toBe('/orders/:id')
  })

  it('falls back to the address when nothing matched', () => {
    expect(
      routeOf({
        req: { method: 'GET', path: '/nope', routePath: '/*', header: () => undefined },
        res: { status: 404 },
        header: () => undefined,
      }),
    ).toBe('/nope')
  })

  it('says so when it knows neither', () => {
    expect(
      routeOf({
        req: { method: 'GET', header: () => undefined },
        res: { status: 500 },
        header: () => undefined,
      }),
    ).toBe('unmatched')
  })
})

describe('a middleware further down that throws', () => {
  it('still gets an access line, and the error still travels', async () => {
    const sink = memorySink()
    const logger = createLogger({ sink, level: 'trace' })
    const context = {
      req: {
        method: 'GET',
        path: '/orders/ord_7',
        routePath: '/orders/:id',
        header: () => undefined,
      },
      res: { status: 500 },
      header: () => undefined,
    }

    await expect(
      nekolog(logger)(context, () => Promise.reject(new Error('the middleware gave up'))),
    ).rejects.toThrow('the middleware gave up')

    expect(sink.events[0]?.message).toBe('GET /orders/:id 500')
    expect(sink.events[0]?.level).toBe('error')
  })
})

describe('the context around the handler', () => {
  it('does not leak between requests', async () => {
    const seen: Array<string | undefined> = []
    const sink = memorySink()
    const logger = createLogger({ sink })
    const hono = new Hono()
    hono.use('*', nekolog(logger))
    hono.get('/x', (c) => {
      seen.push(currentContext()?.attributes?.[REQUEST_ID_ATTRIBUTE] as string | undefined)
      return c.text('ok')
    })

    await Promise.all([hono.request('/x'), hono.request('/x'), hono.request('/x')])

    expect(new Set(seen).size).toBe(3)
  })
})

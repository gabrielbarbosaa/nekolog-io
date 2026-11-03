import { type LogEvent, memorySink, parseTraceparent, TRACEPARENT_HEADER } from '@nekolog-io/core'
import {
  createLogger,
  currentContext,
  METHOD_ATTRIBUTE,
  REQUEST_ID_ATTRIBUTE,
  REQUEST_ID_HEADER,
  ROUTE_ATTRIBUTE,
  STATUS_ATTRIBUTE,
} from '@nekolog-io/node'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { headerOf, nekologPlugin, routeOf, SKIP_OVERRIDE } from './index.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

let running: FastifyInstance | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

async function app(
  options: Omit<Parameters<typeof nekologPlugin>[1], 'logger'> = {},
): Promise<{ server: FastifyInstance; events: LogEvent[]; seen: Array<string | undefined> }> {
  const sink = memorySink()
  const logger = createLogger({ sink, level: 'trace' })
  const seen: Array<string | undefined> = []
  const server = Fastify()

  await server.register(nekologPlugin as never, { logger, ...options } as never)

  server.get('/orders/:id', async () => {
    seen.push(currentContext()?.attributes?.[REQUEST_ID_ATTRIBUTE] as string | undefined)
    logger.info('handling the order')
    return { ok: true }
  })
  server.get('/broken', async () => {
    throw new Error('the handler gave up')
  })

  await server.ready()
  running = server
  return { server, events: sink.events, seen }
}

describe('a request through the plugin', () => {
  it('is logged as an access line', async () => {
    const { server, events } = await app()

    const response = await server.inject({ method: 'GET', url: '/orders/ord_7' })

    expect(response.statusCode).toBe(200)
    const access = events[events.length - 1] as LogEvent
    expect(access.message).toBe('GET /orders/:id 200')
    expect(access.attributes?.[METHOD_ATTRIBUTE]).toBe('GET')
    expect(access.attributes?.[ROUTE_ATTRIBUTE]).toBe('/orders/:id')
    expect(access.attributes?.[STATUS_ATTRIBUTE]).toBe(200)
  })

  it('answers with the trace it continued and a request id', async () => {
    const { server } = await app()

    const response = await server.inject({
      method: 'GET',
      url: '/orders/ord_7',
      headers: { [TRACEPARENT_HEADER]: `00-${TRACE_ID}-${SPAN_ID}-01` },
    })

    expect(parseTraceparent(response.headers[TRACEPARENT_HEADER])?.traceId).toBe(TRACE_ID)
    expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f]{16}$/)
  })

  it('puts the request id on what the handler logs', async () => {
    const { server, events } = await app()

    await server.inject({ method: 'GET', url: '/orders/ord_7' })

    expect(events[0]?.message).toBe('handling the order')
    expect(events[0]?.attributes?.[REQUEST_ID_ATTRIBUTE]).toBeDefined()
  })

  it('does not leak the context between requests', async () => {
    const { server, seen } = await app()

    await Promise.all([
      server.inject({ method: 'GET', url: '/orders/a' }),
      server.inject({ method: 'GET', url: '/orders/b' }),
      server.inject({ method: 'GET', url: '/orders/c' }),
    ])

    expect(new Set(seen).size).toBe(3)
  })

  it('logs a handler that threw, and the access line after it', async () => {
    const { server, events } = await app()

    const response = await server.inject({ method: 'GET', url: '/broken' })

    expect(response.statusCode).toBe(500)
    expect(events.some((event) => event.message === 'the handler gave up')).toBe(true)
    expect(events[events.length - 1]?.attributes?.[STATUS_ATTRIBUTE]).toBe(500)
  })

  it('logs nothing about access when that is turned off', async () => {
    const { server, events } = await app({ accessLog: false })

    await server.inject({ method: 'GET', url: '/orders/ord_7' })

    expect(events).toHaveLength(1)
  })
})

describe('the plugin itself', () => {
  it('is not encapsulated, so the hooks reach the whole app', () => {
    expect((nekologPlugin as unknown as Record<symbol, unknown>)[SKIP_OVERRIDE]).toBe(true)
  })
})

describe('reading the request', () => {
  it('names the route pattern, not the address', () => {
    expect(routeOf({ method: 'GET', headers: {}, routeOptions: { url: '/orders/:id' } })).toBe(
      '/orders/:id',
    )
  })

  it('falls back to the older fastify field', () => {
    expect(routeOf({ method: 'GET', headers: {}, routerPath: '/orders/:id' })).toBe('/orders/:id')
  })

  it('says so when it knows neither', () => {
    expect(routeOf({ method: 'GET', headers: {} })).toBe('unmatched')
  })

  it('reads a header that arrived more than once', () => {
    expect(
      headerOf({ method: 'GET', headers: { 'x-request-id': ['first', 'second'] } }, 'x-request-id'),
    ).toBe('first')
  })

  it('reads nothing out of a header that is not text', () => {
    expect(
      headerOf({ method: 'GET', headers: { 'x-request-id': 42 } }, 'x-request-id'),
    ).toBeUndefined()
  })
})

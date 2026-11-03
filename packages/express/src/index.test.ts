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
import express from 'express'
import { describe, expect, it } from 'vitest'
import { routeOf, statusOfError, withAccessLog, withErrorLog, withLogContext } from './index.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

type Served = { url: string; close: () => Promise<void>; events: LogEvent[]; seen: string[] }

async function serve(): Promise<Served> {
  const sink = memorySink()
  const logger = createLogger({ sink, level: 'trace' })
  const seen: string[] = []
  const app = express()

  app.use(withLogContext() as never)
  app.use(withAccessLog(logger) as never)
  app.get('/orders/:id', (_request, response) => {
    seen.push(String(currentContext()?.attributes?.[REQUEST_ID_ATTRIBUTE]))
    logger.info('handling the order')
    response.json({ ok: true })
  })
  app.get('/broken', () => {
    throw new Error('the handler gave up')
  })
  app.use(withErrorLog(logger) as never)

  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    events: sink.events,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function settled(events: LogEvent[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (events.length >= count) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`gave up waiting for ${count} log lines`)
}

describe('a request through the middleware', () => {
  it('is logged as an access line naming the route pattern', async () => {
    const served = await serve()

    const response = await fetch(`${served.url}/orders/ord_7`)
    await settled(served.events, 2)
    await served.close()

    expect(response.status).toBe(200)
    const access = served.events[served.events.length - 1] as LogEvent
    expect(access.message).toBe('GET /orders/:id 200')
    expect(access.attributes?.[METHOD_ATTRIBUTE]).toBe('GET')
    expect(access.attributes?.[ROUTE_ATTRIBUTE]).toBe('/orders/:id')
    expect(access.attributes?.[STATUS_ATTRIBUTE]).toBe(200)
  })

  it('answers with the trace it continued and a request id', async () => {
    const served = await serve()

    const response = await fetch(`${served.url}/orders/ord_7`, {
      headers: { [TRACEPARENT_HEADER]: `00-${TRACE_ID}-${SPAN_ID}-01` },
    })
    await settled(served.events, 2)
    await served.close()

    expect(parseTraceparent(response.headers.get(TRACEPARENT_HEADER))?.traceId).toBe(TRACE_ID)
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('puts the request id on what the handler logs, and on the access line', async () => {
    const served = await serve()

    await fetch(`${served.url}/orders/ord_7`)
    await settled(served.events, 2)
    await served.close()

    expect(served.events[0]?.message).toBe('handling the order')
    expect(served.events[0]?.attributes?.[REQUEST_ID_ATTRIBUTE]).toBe(served.seen[0])
    expect(served.events[1]?.attributes?.[REQUEST_ID_ATTRIBUTE]).toBe(served.seen[0])
  })

  it('does not mix up two requests at once', async () => {
    const served = await serve()

    await Promise.all([
      fetch(`${served.url}/orders/a`),
      fetch(`${served.url}/orders/b`),
      fetch(`${served.url}/orders/c`),
    ])
    await settled(served.events, 6)
    await served.close()

    expect(new Set(served.seen).size).toBe(3)
  })

  it('logs a handler that threw as an error, and still answers 500', async () => {
    const served = await serve()

    const response = await fetch(`${served.url}/broken`)
    await settled(served.events, 2)
    await served.close()

    expect(response.status).toBe(500)
    expect(served.events.some((event) => event.message === 'the handler gave up')).toBe(true)
  })

  it('logs a route nobody matched as a warning', async () => {
    const served = await serve()

    await fetch(`${served.url}/nowhere`)
    await settled(served.events, 1)
    await served.close()

    const access = served.events[served.events.length - 1] as LogEvent
    expect(access.level).toBe('warn')
    expect(access.attributes?.[ROUTE_ATTRIBUTE]).toBe('unmatched')
  })
})

describe('the access line and the request it belongs to', () => {
  it('carries the request context even when finish fires outside it', () => {
    const sink = memorySink()
    const logger = createLogger({ sink, level: 'trace' })
    const listeners: Array<() => void> = []
    const request = { method: 'GET', route: { path: '/orders/:id' }, get: () => undefined }
    const response = {
      statusCode: 200,
      setHeader: () => undefined,
      on: (_event: string, listener: () => void) => listeners.push(listener),
    }

    withLogContext({ newRequestId: () => 'req_known' })(request, response, () => {
      withAccessLog(logger)(request, response, () => undefined)
    })

    for (const listener of listeners.splice(0)) {
      listener()
    }

    expect(sink.events[0]?.attributes?.[REQUEST_ID_ATTRIBUTE]).toBe('req_known')
  })
})

describe('reading the request', () => {
  it('names the route pattern with the mount point in front', () => {
    expect(
      routeOf({
        method: 'GET',
        baseUrl: '/api',
        route: { path: '/orders/:id' },
        get: () => undefined,
      }),
    ).toBe('/api/orders/:id')
  })

  it('says so when nothing matched', () => {
    expect(routeOf({ method: 'GET', get: () => undefined })).toBe('unmatched')
  })
})

describe('the status an error deserves', () => {
  it.each([
    [{ status: 404 }, 404],
    [{ statusCode: 403 }, 403],
    [{ status: 200 }, 500],
    [{ status: 'teapot' }, 500],
    [{ status: 4.5 }, 500],
    [new Error('plain'), 500],
    [null, 500],
  ])('reads %j as %i', (error, expected) => {
    expect(statusOfError(error)).toBe(expected)
  })
})

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type LogEvent, memorySink } from '@nekolog-io/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { createExampleLogger } from './logger.ts'

const sink = memorySink()
const logger = createExampleLogger({ sink, level: 'trace' })

let server: Server
let base = ''
let sent = 0

async function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  const started = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => started.once('listening', () => resolve()))
  return started
}

function linesFor(requestId: string): LogEvent[] {
  return sink.events.filter((event) => event.attributes?.['request.id'] === requestId)
}

async function settled(requestId: string, expected: number): Promise<LogEvent[]> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const mine = linesFor(requestId)
    if (mine.length >= expected) {
      return mine
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`only ${linesFor(requestId).length} of ${expected} lines were logged`)
}

type Sent = {
  response: Response
  lines: LogEvent[]
  requestId: string
}

async function send(path: string, init: RequestInit = {}, expected = 2): Promise<Sent> {
  sent += 1
  const given = `r.${sent}`
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'x-request-id': given, ...((init.headers ?? {}) as Record<string, string>) },
  })
  const requestId = response.headers.get('x-request-id') ?? given

  return { response, lines: await settled(requestId, expected), requestId }
}

function named(lines: LogEvent[], message: string): LogEvent | undefined {
  return lines.find((event) => event.message === message)
}

function accessLine(lines: LogEvent[]): LogEvent {
  const found = lines.find((event) => event.attributes?.['http.status'] !== undefined)
  if (found === undefined) {
    throw new Error('no access log line was written')
  }
  return found
}

function failureLine(lines: LogEvent[]): LogEvent {
  const found = lines.find((event) => event.error !== undefined)
  if (found === undefined) {
    throw new Error('no failure was logged')
  }
  return found
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeAll(async () => {
  server = await listen(createApp({ logger, newOrderId: () => 'ord_fixed' }))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('a request that works', () => {
  it('answers and writes one access line plus the line the route asked for', async () => {
    const { response, lines } = await send('/orders/ord_7f3a91')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'ord_7f3a91' })
    expect(lines).toHaveLength(2)
    expect(named(lines, 'Order looked up')?.attributes).toMatchObject({ 'order.id': 'ord_7f3a91' })
    expect(accessLine(lines).level).toBe('info')
  })

  it('names the matched route in the access line, not the path the caller typed', async () => {
    const { lines } = await send('/orders/ord_7f3a91')

    expect(accessLine(lines).attributes).toMatchObject({
      'http.method': 'GET',
      'http.route': '/orders/:id',
      'http.status': 200,
    })
    expect(accessLine(lines).message).toBe('GET /orders/:id 200')
  })

  it('puts every line of the request under one trace', async () => {
    const { lines } = await send('/orders/ord_7f3a91')

    const traces = new Set(lines.map((event) => event.trace?.traceId))
    expect(traces.size).toBe(1)
    expect([...traces][0]).toMatch(/^[0-9a-f]{32}$/)
  })

  it('carries what the route added later into the access line written at the end', async () => {
    const { lines } = await send('/orders/ord_7f3a91')

    expect(accessLine(lines).attributes).toMatchObject({ 'order.id': 'ord_7f3a91' })
  })

  it('does not log the health check, which a load balancer calls every second', async () => {
    const before = sink.events.length
    const response = await fetch(`${base}/health`, { headers: { 'x-request-id': 'r.health' } })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(response.status).toBe(200)
    expect(linesFor('r.health')).toHaveLength(0)
    expect(sink.events.length).toBe(before)
  })
})

describe('the trace the caller handed us', () => {
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
  const spanId = '00f067aa0ba902b7'

  it('continues under the same trace id, with a span of its own', async () => {
    const { response, lines } = await send('/orders/ord_7f3a91', {
      headers: { traceparent: `00-${traceId}-${spanId}-01` },
    })

    expect(lines[0]?.trace?.traceId).toBe(traceId)
    expect(lines[0]?.trace?.spanId).not.toBe(spanId)
    expect(lines[0]?.attributes).toMatchObject({ 'trace.parentSpanId': spanId })
    expect(response.headers.get('traceparent')).toBe(`00-${traceId}-${lines[0]?.trace?.spanId}-01`)
  })

  it('starts a trace of its own when the header is garbage', async () => {
    const { response, lines } = await send('/orders/ord_7f3a91', {
      headers: { traceparent: `ff-${traceId}-${spanId}-01` },
    })

    expect(lines[0]?.trace?.traceId).not.toBe(traceId)
    expect(response.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('keeps a request id that is safe to put in a log line', async () => {
    const { response, requestId } = await send('/orders/ord_7f3a91', {
      headers: { 'x-request-id': 'abc.def' },
    })

    expect(response.headers.get('x-request-id')).toBe('abc.def')
    expect(requestId).toBe('abc.def')
  })

  it('replaces one the caller filled with junk', async () => {
    const junk = 'a'.repeat(500)
    const { requestId, lines } = await send('/orders/ord_7f3a91', {
      headers: { 'x-request-id': junk },
    })

    expect(requestId).not.toBe(junk)
    expect(requestId.length).toBeLessThanOrEqual(64)
    expect(accessLine(lines).attributes).toMatchObject({ 'request.id': requestId })
  })
})

describe('a request that creates something', () => {
  const order = { customerId: 'cus_7f3a91', email: 'ana@exemplo.com', totalCents: 4990 }

  it('answers 201 and records who did it', async () => {
    const { response, lines } = await send('/orders', json(order))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 'ord_fixed' })
    expect(named(lines, 'Order created')?.session).toEqual({ userId: 'cus_7f3a91' })
  })

  it('never writes the email, because this example calls it sensitive', async () => {
    const { lines } = await send('/orders', json(order))

    expect(named(lines, 'Order created')?.attributes).toMatchObject({
      'customer.email': '[redacted]',
      'order.totalCents': 4990,
    })
    expect(JSON.stringify(lines)).not.toContain('ana@exemplo.com')
  })

  it('refuses a body it cannot trust, with a message that helps', async () => {
    const { response, lines } = await send('/orders', json({ ...order, totalCents: -1 }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { message: expect.any(String) } })
    expect(accessLine(lines).level).toBe('warn')
  })

  it('logs a refused body as a client problem, not as ours to be paged about', async () => {
    const { lines } = await send('/orders', json({ ...order, totalCents: -1 }))

    expect(failureLine(lines).level).toBe('warn')
    expect(lines.some((event) => event.level === 'error')).toBe(false)
  })
})

describe('a request that fails', () => {
  it('answers 500 without repeating what broke', async () => {
    const { response, lines } = await send('/boom')
    const body = (await response.json()) as { error: { message: string } }

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('Internal Server Error')
    expect(JSON.stringify(body)).not.toContain('10.0.3.14')
    expect(accessLine(lines).level).toBe('error')
  })

  it('logs the whole error, which is the part that is ours to read', async () => {
    const { lines } = await send('/boom')

    expect(failureLine(lines).level).toBe('error')
    expect(failureLine(lines).error?.message).toContain('10.0.3.14')
    expect(failureLine(lines).error?.stack).toContain('Error')
  })

  it('answers 404 as a client error, not a server one', async () => {
    const { response, lines } = await send('/nope')

    expect(response.status).toBe(404)
    expect(accessLine(lines).level).toBe('warn')
    expect(accessLine(lines).attributes).toMatchObject({ 'http.route': 'unmatched' })
  })
})

describe('the sdk failing', () => {
  it('does not take the application down with it', async () => {
    const failures: unknown[] = []
    const exploding = createExampleLogger({
      level: 'trace',
      onError: (error) => failures.push(error),
      sink: {
        emit() {
          throw new Error('the sink is broken')
        },
      },
    })
    const other = await listen(createApp({ logger: exploding }))
    const address = `http://127.0.0.1:${(other.address() as AddressInfo).port}`

    try {
      const response = await fetch(`${address}/orders/ord_7f3a91`)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: 'ord_7f3a91' })
      expect(failures.length).toBeGreaterThan(0)
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()))
    }
  })
})

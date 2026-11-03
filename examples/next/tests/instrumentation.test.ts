import { type LogEvent, memorySink, parseTraceparent } from '@nekolog-io/core'
import { serverLogger, register as startNekolog, unregister } from '@nekolog-io/next'
import { afterEach, describe, expect, it } from 'vitest'
import { CUSTOMER_ID_PATTERN, POST, parseOrder } from '../app/api/orders/route'
import { onRequestError, options, register } from '../instrumentation'

afterEach(async () => {
  await unregister()
})

function watching(): LogEvent[] {
  const sink = memorySink()
  startNekolog({ ...options, sink, processHooks: false })
  return sink.events
}

describe('what instrumentation.ts wires up', () => {
  it('starts a server logger', () => {
    expect(serverLogger()).toBeUndefined()

    register()

    expect(serverLogger()?.resource.service).toBe('example-next')
  })

  it('hands Next a handler for the errors it catches', () => {
    expect(typeof onRequestError).toBe('function')
  })

  it('logs what Next hands back, without the query string', () => {
    const events = watching()

    onRequestError(new Error('the database refused'), {
      path: '/checkout?coupon=SECRET10',
      method: 'POST',
    })

    expect(events[0]?.level).toBe('error')
    expect(events[0]?.message).toBe('the database refused')
    expect(events[0]?.attributes?.['http.path']).toBe('/checkout')
    expect(JSON.stringify(events[0])).not.toContain('SECRET10')
  })
})

describe('the route handler', () => {
  it('logs the order it created, and who placed it', async () => {
    const events = watching()

    const response = await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: 'cus_7f3a91',
          email: 'ana@exemplo.com',
          totalCents: 4990,
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(events[0]?.message).toBe('Order created')
    expect(events[0]?.session?.userId).toBe('cus_7f3a91')
  })

  it('never lets the customer email through', async () => {
    const events = watching()

    await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: 'cus_7f3a91',
          email: 'ana@exemplo.com',
          totalCents: 4990,
        }),
      }),
    )

    expect(events[0]?.attributes?.['customer.email']).toBe('[redacted]')
    expect(JSON.stringify(events[0])).not.toContain('ana@exemplo.com')
  })

  it('refuses a body it cannot trust, and says why', async () => {
    const events = watching()

    const response = await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: 'not-a-customer' }),
      }),
    )

    expect(response.status).toBe(400)
    expect(events[0]?.level).toBe('warn')
  })

  it('logs nothing and does not throw when nobody registered', async () => {
    const response = await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: 'cus_1', email: 'a@b.test', totalCents: 1 }),
      }),
    )

    expect(response.status).toBe(201)
  })
})

describe('the context a route handler runs in', () => {
  const body = JSON.stringify({ customerId: 'cus_7f3a91', email: 'a@b.test', totalCents: 1 })

  function order(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
  }

  it('answers with the trace it continued and a request id', async () => {
    watching()

    const response = await POST(order({ traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` }))

    expect(parseTraceparent(response.headers.get('traceparent'))?.traceId).toBe('a'.repeat(32))
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('writes an access line naming the route, after the handler line', async () => {
    const events = watching()

    await POST(order())

    expect(events.map((event) => event.message)).toEqual(['Order created', 'POST /api/orders 201'])
    expect(events[1]?.attributes?.['http.route']).toBe('/api/orders')
  })

  it('puts the same request id on both lines', async () => {
    const events = watching()

    await POST(order())

    const id = events[0]?.attributes?.['request.id']
    expect(id).toBeDefined()
    expect(events[1]?.attributes?.['request.id']).toBe(id)
  })

  it('logs a refusal as a warning and says 400', async () => {
    const events = watching()

    await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: 'nope' }),
      }),
    )

    expect(events[1]?.level).toBe('warn')
    expect(events[1]?.attributes?.['http.status']).toBe(400)
  })
})

describe('what a customer id is allowed to be', () => {
  it.each(['cus_7f3a91', 'cus_1'])('takes %j', (value) => {
    expect(CUSTOMER_ID_PATTERN.test(value)).toBe(true)
  })

  it.each(['ord_7f3a91', 'cus_', 'cus_ABC', '../../etc/passwd'])('refuses %j', (value) => {
    expect(CUSTOMER_ID_PATTERN.test(value)).toBe(false)
  })

  it('refuses a body that is not an object', () => {
    expect(typeof parseOrder([])).toBe('string')
    expect(typeof parseOrder(null)).toBe('string')
  })
})

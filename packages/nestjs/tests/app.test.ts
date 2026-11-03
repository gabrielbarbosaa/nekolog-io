import 'reflect-metadata'
import { type LogEvent, memorySink, parseTraceparent, TRACEPARENT_HEADER } from '@nekolog-io/core'
import {
  currentContext,
  METHOD_ATTRIBUTE,
  REQUEST_ID_ATTRIBUTE,
  REQUEST_ID_HEADER,
  ROUTE_ATTRIBUTE,
  STATUS_ATTRIBUTE,
} from '@nekolog-io/node'
import type { INestApplication } from '@nestjs/common'
import { Controller, Get, Inject, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { afterEach, describe, expect, it } from 'vitest'
import { NekologModule } from '../src/module.ts'
import { NEKOLOG_LOGGER } from '../src/tokens.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

const seen: Array<string | undefined> = []
const sink = memorySink()

class OrdersController {
  constructor(private readonly logger: { info(message: string): void }) {}

  find(): { ok: boolean } {
    seen.push(currentContext()?.attributes?.[REQUEST_ID_ATTRIBUTE] as string | undefined)
    this.logger.info('handling the order')
    return { ok: true }
  }

  broken(): never {
    throw new Error('the handler gave up')
  }
}

Controller('orders')(OrdersController)
Inject(NEKOLOG_LOGGER)(OrdersController, undefined, 0)
Get(':id')(
  OrdersController.prototype,
  'find',
  Object.getOwnPropertyDescriptor(OrdersController.prototype, 'find') as PropertyDescriptor,
)
Get('broken/now')(
  OrdersController.prototype,
  'broken',
  Object.getOwnPropertyDescriptor(OrdersController.prototype, 'broken') as PropertyDescriptor,
)

class ShopModule {}

let running: INestApplication | undefined

async function serve(): Promise<{ url: string; events: LogEvent[] }> {
  sink.events.length = 0
  seen.length = 0

  Module({
    imports: [NekologModule.forRoot({ sink, level: 'trace' })],
    controllers: [OrdersController],
  })(ShopModule)

  const app = await NestFactory.create(ShopModule, { logger: false })
  await app.listen(0)
  running = app

  const url = await app.getUrl()
  return { url: url.replace('[::1]', '127.0.0.1'), events: sink.events }
}

afterEach(async () => {
  await running?.close()
  running = undefined
})

async function settled(events: LogEvent[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (events.length >= count) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`gave up waiting for ${count} log lines`)
}

describe('a nest app with the module installed', () => {
  it('logs an access line naming the route pattern', async () => {
    const served = await serve()

    const response = await fetch(`${served.url}/orders/ord_7`)
    await settled(served.events, 2)

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

    expect(parseTraceparent(response.headers.get(TRACEPARENT_HEADER))?.traceId).toBe(TRACE_ID)
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('gives the controller the request context', async () => {
    const served = await serve()

    await fetch(`${served.url}/orders/ord_7`)
    await settled(served.events, 2)

    expect(seen[0]).toBeDefined()
    expect(served.events[0]?.message).toBe('handling the order')
    expect(served.events[0]?.attributes?.[REQUEST_ID_ATTRIBUTE]).toBe(seen[0])
  })

  it('does not mix up requests that overlap', async () => {
    const served = await serve()

    await Promise.all([
      fetch(`${served.url}/orders/a`),
      fetch(`${served.url}/orders/b`),
      fetch(`${served.url}/orders/c`),
    ])
    await settled(served.events, 6)

    expect(new Set(seen).size).toBe(3)
  })

  it('still logs an access line when the handler threw', async () => {
    const served = await serve()

    const response = await fetch(`${served.url}/orders/broken/now`)
    await settled(served.events, 1)

    expect(response.status).toBe(500)
    const access = served.events[served.events.length - 1] as LogEvent
    expect(access.level).toBe('error')
    expect(access.attributes?.[STATUS_ATTRIBUTE]).toBe(500)
  })

  it('injects the logger wherever it is asked for', async () => {
    const served = await serve()

    await fetch(`${served.url}/orders/ord_7`)
    await settled(served.events, 2)

    expect(served.events[0]?.message).toBe('handling the order')
    expect(served.events[0]?.level).toBe('info')
  })
})

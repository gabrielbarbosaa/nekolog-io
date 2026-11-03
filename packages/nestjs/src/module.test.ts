import 'reflect-metadata'
import { createLogger, type LogEvent, memorySink } from '@nekolog-io/core'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { of, throwError } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { type InterceptorOptions, NekologInterceptor } from './interceptor.ts'
import { NekologModule } from './module.ts'

function providers(module: ReturnType<typeof NekologModule.forRoot>): unknown[] {
  return (module.providers ?? []) as unknown[]
}

function tokens(module: ReturnType<typeof NekologModule.forRoot>): unknown[] {
  return providers(module).map((provider) => (provider as { provide?: unknown }).provide)
}

describe('what the module provides', () => {
  it('registers the interceptor with nest', () => {
    expect(tokens(NekologModule.forRoot())).toContain(APP_INTERCEPTOR)
  })

  it('registers no interceptor when the caller said not to', () => {
    expect(tokens(NekologModule.forRoot({ interceptor: false }))).not.toContain(APP_INTERCEPTOR)
  })

  it('is global unless the caller says otherwise', () => {
    expect(NekologModule.forRoot().global).toBe(true)
    expect(NekologModule.forRoot({ global: false }).global).toBe(false)
  })

  it('builds the logger from a factory when asked asynchronously', async () => {
    const module = NekologModule.forRootAsync({ useFactory: () => ({ service: 'from-a-factory' }) })
    const provider = providers(module)[0] as { useFactory: () => Promise<{ resource: unknown }> }

    const logger = await provider.useFactory()

    expect((logger.resource as { service?: string }).service).toBe('from-a-factory')
  })
})

function execution(): ExecutionContext {
  const request = { method: 'GET', route: { path: '/orders/:id' }, headers: {} }
  const response = { statusCode: 200, setHeader: () => undefined }
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext
}

function ran(
  options: InterceptorOptions,
  handler: CallHandler = { handle: () => of('answer') },
): LogEvent[] {
  const sink = memorySink()
  const interceptor = new NekologInterceptor(createLogger({ sink, level: 'trace' }), options)
  const stream = interceptor.intercept(execution(), handler)
  stream.subscribe({ error: () => undefined })
  return sink.events
}

describe('the access log switch', () => {
  it('writes a line by default', () => {
    expect(ran({})).toHaveLength(1)
  })

  it('writes nothing when it is turned off', () => {
    expect(ran({ accessLog: false })).toEqual([])
  })

  it('writes only the error when the access log is off and the handler threw', () => {
    const events = ran({ accessLog: false }, { handle: () => throwError(() => new Error('boom')) })

    expect(events).toHaveLength(1)
    expect(events[0]?.message).toBe('boom')
    expect(events[0]?.error?.type).toBe('Error')
  })

  it('writes nothing at all when both are off', () => {
    expect(
      ran(
        { accessLog: false, errorLog: false },
        { handle: () => throwError(() => new Error('boom')) },
      ),
    ).toEqual([])
  })
})

describe('an error the handler threw', () => {
  it('is logged with its stack, beside the access line', () => {
    const events = ran({}, { handle: () => throwError(() => new Error('the database refused')) })

    expect(events.map((event) => event.message)).toEqual([
      'the database refused',
      'GET /orders/:id 500',
    ])
    expect(events[0]?.error?.stack).toContain('the database refused')
    expect(events[0]?.level).toBe('error')
  })
})

describe('something that is not an http request', () => {
  it('is passed straight through', () => {
    const sink = memorySink()
    const interceptor = new NekologInterceptor(createLogger({ sink, level: 'trace' }))
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext

    const seen: unknown[] = []
    interceptor.intercept(context, { handle: () => of('rpc answer') }).subscribe({
      next: (value) => seen.push(value),
    })

    expect(seen).toEqual(['rpc answer'])
    expect(sink.events).toEqual([])
  })
})

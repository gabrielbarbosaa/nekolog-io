import { type LogEvent, memorySink } from '@nekolog-io/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PATH_ATTRIBUTE, ROUTE_ATTRIBUTE } from './request.ts'
import { NEXT_RUNTIME_ENV, nextRuntime } from './runtime.ts'
import { createOnRequestError, register, serverLogger, unregister } from './server.ts'
import { SDK_NAME } from './version.ts'

const originalRuntime = process.env[NEXT_RUNTIME_ENV]

beforeEach(() => {
  delete process.env[NEXT_RUNTIME_ENV]
})

afterEach(async () => {
  await unregister()
  if (originalRuntime === undefined) {
    delete process.env[NEXT_RUNTIME_ENV]
  } else {
    process.env[NEXT_RUNTIME_ENV] = originalRuntime
  }
})

describe('which runtime instrumentation is running in', () => {
  it('believes what Next says', () => {
    process.env[NEXT_RUNTIME_ENV] = 'edge'
    expect(nextRuntime()).toBe('edge')

    process.env[NEXT_RUNTIME_ENV] = 'nodejs'
    expect(nextRuntime()).toBe('nodejs')
  })

  it('does not believe a value it has never heard of', () => {
    expect(nextRuntime({ [NEXT_RUNTIME_ENV]: 'mainframe' })).toBe('nodejs')
  })
})

describe('registering', () => {
  it('builds a node logger that says it is the next sdk', () => {
    const logger = register({ sink: memorySink(), processHooks: false })

    expect(logger.resource.runtime).toBe('node')
    expect(logger.sdk.name).toBe(SDK_NAME)
  })

  it('builds an edge logger on the edge runtime', () => {
    process.env[NEXT_RUNTIME_ENV] = 'edge'

    expect(register({ sink: memorySink() }).resource.runtime).toBe('edge')
  })

  it('builds one logger, however many times it is called', () => {
    const first = register({ sink: memorySink(), processHooks: false })

    expect(register({ sink: memorySink(), processHooks: false })).toBe(first)
    expect(serverLogger()).toBe(first)
  })

  it('leaves nothing behind after unregistering', async () => {
    register({ sink: memorySink(), processHooks: false })

    await unregister()

    expect(serverLogger()).toBeUndefined()
  })
})

describe('an error Next hands back', () => {
  function watching(): {
    events: LogEvent[]
    onRequestError: ReturnType<typeof createOnRequestError>
  } {
    const sink = memorySink()
    const logger = register({ sink, processHooks: false })
    return { events: sink.events, onRequestError: createOnRequestError(() => logger) }
  }

  it('is logged with where it happened', () => {
    const { events, onRequestError } = watching()

    onRequestError(
      new Error('the database refused'),
      { path: '/checkout?coupon=SECRET10', method: 'POST' },
      { routePath: '/checkout' },
    )

    expect(events[0]?.level).toBe('error')
    expect(events[0]?.message).toBe('the database refused')
    expect(events[0]?.attributes?.[PATH_ATTRIBUTE]).toBe('/checkout')
    expect(events[0]?.attributes?.[ROUTE_ATTRIBUTE]).toBe('/checkout')
  })

  it('never carries the coupon of the address', () => {
    const { events, onRequestError } = watching()

    onRequestError(new Error('boom'), { path: '/checkout?coupon=SECRET10' }, undefined)

    expect(JSON.stringify(events[0])).not.toContain('SECRET10')
  })

  it('is dropped quietly when nobody registered', () => {
    const handler = createOnRequestError(() => undefined)

    expect(() => handler(new Error('boom'))).not.toThrow()
  })

  it('does not throw back into Next when the logger fails', () => {
    const handler = createOnRequestError(
      () =>
        ({
          error: () => {
            throw new Error('the logger gave up')
          },
        }) as never,
    )

    expect(() => handler(new Error('boom'))).not.toThrow()
  })

  it('is logged even with nothing but the error', () => {
    const { events, onRequestError } = watching()

    onRequestError(new Error('boom'))

    expect(events[0]?.message).toBe('boom')
    expect(events[0]?.attributes).toBeUndefined()
  })
})

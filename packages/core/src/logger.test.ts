import { describe, expect, it, vi } from 'vitest'
import { createLogger } from './logger.ts'
import { memorySink } from './sinks.ts'
import type { LoggerOptions, Sink } from './types.ts'

const FIXED_NOW = Date.UTC(2026, 9, 30, 14, 3, 12, 481)

function setup(options: Partial<LoggerOptions> = {}) {
  const sink = memorySink()
  const logger = createLogger({ sink, now: () => FIXED_NOW, level: 'trace', ...options })
  return { logger, sink }
}

describe('contextProvider', () => {
  it('puts the ambient context under the logger own context', () => {
    let ambient: LoggerOptions['context']
    const { logger, sink } = setup({ contextProvider: () => ambient })

    ambient = { attributes: { requestId: 'r-1', step: 'ambient' } }
    logger.child({ attributes: { step: 'child' } }).info('hello')

    expect(sink.events[0]?.attributes).toEqual({ requestId: 'r-1', step: 'child' })
  })

  it('is read at every call, not captured once', () => {
    let ambient: LoggerOptions['context'] = { attributes: { requestId: 'r-1' } }
    const { logger, sink } = setup({ contextProvider: () => ambient })

    logger.info('first')
    ambient = { attributes: { requestId: 'r-2' } }
    logger.info('second')

    expect(sink.events.map((event) => event.attributes?.requestId)).toEqual(['r-1', 'r-2'])
  })

  it('keeps the log when the provider throws', () => {
    const onError = vi.fn()
    const { logger, sink } = setup({
      onError,
      contextProvider: () => {
        throw new Error('no store')
      },
    })

    expect(() => logger.info('kept')).not.toThrow()
    expect(sink.events.map((event) => event.message)).toEqual(['kept'])
    expect(onError).toHaveBeenCalled()
  })
})

describe('levels', () => {
  it('writes an event for every level at or above the threshold', () => {
    const { logger, sink } = setup({ level: 'warn' })

    logger.trace('a')
    logger.debug('b')
    logger.info('c')
    logger.warn('d')
    logger.error('e')
    logger.fatal('f')

    expect(sink.events.map((event) => event.level)).toEqual(['warn', 'error', 'fatal'])
  })

  it('defaults to info', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.debug('dropped')
    logger.info('kept')

    expect(sink.events.map((event) => event.message)).toEqual(['kept'])
  })

  it('answers isLevelEnabled against the threshold', () => {
    const { logger } = setup({ level: 'error' })

    expect(logger.isLevelEnabled('warn')).toBe(false)
    expect(logger.isLevelEnabled('error')).toBe(true)
  })

  it('changes the threshold for loggers already created, parent and child alike', () => {
    const { logger, sink } = setup({ level: 'error' })
    const child = logger.child({ attributes: { a: 1 } })

    child.info('dropped')
    logger.setLevel('info')
    child.info('kept')

    expect(sink.events.map((event) => event.message)).toEqual(['kept'])
  })

  it('ignores an unknown level instead of accepting it', () => {
    const onError = vi.fn()
    const { logger, sink } = setup({ level: 'info', onError })

    logger.setLevel('shout' as never)
    logger.log('shout' as never, 'nope')
    logger.info('yes')

    expect(sink.events.map((event) => event.message)).toEqual(['yes'])
    expect(onError).toHaveBeenCalledOnce()
  })

  it('writes nothing at all when disabled', () => {
    const { logger, sink } = setup({ enabled: false })

    logger.fatal('silence')

    expect(sink.events).toEqual([])
  })
})

describe('the event it builds', () => {
  it('stamps an RFC 3339 UTC timestamp with milliseconds', () => {
    const { logger, sink } = setup()

    logger.info('hello')

    expect(sink.events[0]?.timestamp).toBe('2026-10-30T14:03:12.481Z')
  })

  it('flattens nested attributes into dotted keys', () => {
    const { logger, sink } = setup()

    logger.info('hello', { user: { id: 42, name: 'Alex' }, ok: true })

    expect(sink.events[0]?.attributes).toEqual({ 'user.id': 42, 'user.name': 'Alex', ok: true })
  })

  it('omits attributes entirely when there are none', () => {
    const { logger, sink } = setup()

    logger.info('hello')

    expect(sink.events[0]).not.toHaveProperty('attributes')
  })
})

describe('errors', () => {
  it('takes the message from an Error and records type and stack', () => {
    const { logger, sink } = setup()
    const failure = new TypeError('Cannot read properties of undefined')

    logger.error(failure)

    expect(sink.events[0]?.message).toBe('Cannot read properties of undefined')
    expect(sink.events[0]?.error?.type).toBe('TypeError')
    expect(sink.events[0]?.error?.stack).toContain('TypeError')
  })

  it('keeps attributes passed alongside an Error', () => {
    const { logger, sink } = setup()

    logger.error(new Error('boom'), { step: 'payment' })

    expect(sink.events[0]?.attributes).toEqual({ step: 'payment' })
  })

  it('uses the error type when the error carries no message', () => {
    const { logger, sink } = setup()

    logger.error(new RangeError(''))

    expect(sink.events[0]?.message).toBe('RangeError')
  })

  it('describes a thrown non-Error instead of dropping it', () => {
    const { logger, sink } = setup()

    logger.error({ code: 'ECONN' })

    expect(sink.events[0]?.message).toBe('{"code":"ECONN"}')
    expect(sink.events[0]).not.toHaveProperty('error')
  })

  it('does not treat a plain string as an error', () => {
    const { logger, sink } = setup()

    logger.error('just text')

    expect(sink.events[0]?.message).toBe('just text')
    expect(sink.events[0]).not.toHaveProperty('error')
  })
})

describe('child', () => {
  it('merges the parent attributes under the child ones', () => {
    const { logger, sink } = setup()

    logger
      .child({ attributes: { requestId: 'r1', shared: 'parent' } })
      .info('hello', { shared: 'call' })

    expect(sink.events[0]?.attributes).toEqual({ requestId: 'r1', shared: 'call' })
  })

  it('lets a grandchild add to, not replace, what it inherited', () => {
    const { logger, sink } = setup()

    logger
      .child({ attributes: { a: 1 } })
      .child({ attributes: { b: 2 } })
      .info('hello')

    expect(sink.events[0]?.attributes).toEqual({ a: 1, b: 2 })
  })

  it('leaves the parent untouched', () => {
    const { logger, sink } = setup()

    logger.child({ attributes: { requestId: 'r1' } })
    logger.info('hello')

    expect(sink.events[0]).not.toHaveProperty('attributes')
  })

  it('inherits trace and session, and lets the child override them', () => {
    const { logger, sink } = setup()
    const trace = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    }

    logger
      .child({ trace, session: { id: 's_1' } })
      .child({ session: { userId: 'u_42' } })
      .info('hello')

    expect(sink.events[0]?.trace).toEqual(trace)
    expect(sink.events[0]?.session).toEqual({ id: 's_1', userId: 'u_42' })
  })

  it('carries a fingerprint set on the parent', () => {
    const { logger, sink } = setup()

    logger.child({ fingerprint: ['payment', 'gateway-timeout'] }).error('boom')

    expect(sink.events[0]?.fingerprint).toEqual(['payment', 'gateway-timeout'])
  })
})

describe('never throwing into the host app', () => {
  const exploding: Sink = {
    emit() {
      throw new Error('sink is broken')
    },
  }

  it('swallows a sink that throws and reports it to onError', () => {
    const onError = vi.fn()
    const logger = createLogger({ sink: exploding, onError })

    expect(() => logger.info('hello')).not.toThrow()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('swallows an onError that throws as well', () => {
    const logger = createLogger({
      sink: exploding,
      onError: () => {
        throw new Error('onError is broken too')
      },
    })

    expect(() => logger.info('hello')).not.toThrow()
  })

  it('swallows a clock that throws', () => {
    const onError = vi.fn()
    const { logger } = setup({
      onError,
      now: () => {
        throw new Error('no clock')
      },
    })

    expect(() => logger.info('hello')).not.toThrow()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('drops only the attribute whose getter throws, and keeps the log', () => {
    const { logger, sink } = setup()
    const hostile = {
      get boom(): never {
        throw new Error('getter')
      },
      safe: 1,
    }

    expect(() => logger.info('hello', hostile)).not.toThrow()
    expect(sink.events[0]?.message).toBe('hello')
    expect(sink.events[0]?.attributes).toEqual({ boom: '[unreadable]', safe: 1 })
  })

  it('survives a circular attribute object', () => {
    const { logger, sink } = setup()
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic

    expect(() => logger.info('hello', { cyclic })).not.toThrow()
    expect(sink.events[0]?.attributes).toEqual({
      'cyclic.name': 'root',
      'cyclic.self': '[Circular]',
    })
  })

  it('falls back to a usable timestamp when the clock returns nonsense', () => {
    const { logger, sink } = setup({ now: () => Number.NaN })

    logger.info('hello')

    expect(sink.events[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('resource and sdk', () => {
  it('defaults the service and identifies the sdk', () => {
    const { logger } = setup()

    expect(logger.resource.service).toBe('default')
    expect(logger.sdk.name).toBe('@nekolog-io/core')
  })

  it('keeps the service, release and runtime it was given', () => {
    const { logger } = setup({ service: 'checkout-web', release: '1.4.2', runtime: 'browser' })

    expect(logger.resource).toEqual({
      service: 'checkout-web',
      release: '1.4.2',
      runtime: 'browser',
    })
  })

  it('ignores a runtime that is not in the contract', () => {
    const { logger } = setup({ runtime: 'mainframe' as never })

    expect(['browser', 'node', 'edge', 'bun', 'deno']).toContain(logger.resource.runtime)
  })
})

describe('flush', () => {
  it('delegates to the sink', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const logger = createLogger({ sink: { emit() {}, flush } })

    await logger.flush()

    expect(flush).toHaveBeenCalledOnce()
  })

  it('resolves even when the sink has no flush', async () => {
    const { logger } = setup()

    await expect(logger.flush()).resolves.toBeUndefined()
  })

  it('swallows a flush that rejects', async () => {
    const onError = vi.fn()
    const logger = createLogger({
      onError,
      sink: { emit() {}, flush: () => Promise.reject(new Error('nope')) },
    })

    await expect(logger.flush()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
  })
})

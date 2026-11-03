import { createLogger, type LogEvent, memorySink } from '@nekolog-io/core'
import { describe, expect, it } from 'vitest'
import winston from 'winston'
import {
  attributesOf,
  errorOf,
  levelOf,
  MESSAGE_ATTRIBUTE,
  NekologTransport,
  WINSTON_OWN_FIELDS,
} from './index.ts'

function watching(options: { skip?: readonly string[] } = {}): {
  events: LogEvent[]
  transport: NekologTransport
} {
  const sink = memorySink()
  const logger = createLogger({ sink, level: 'trace' })
  return { events: sink.events, transport: new NekologTransport({ logger, ...options }) }
}

function app(levels?: winston.LoggerOptions['levels']): {
  events: LogEvent[]
  log: winston.Logger
} {
  const { events, transport } = watching()
  return {
    events,
    log: winston.createLogger({
      level: levels === undefined ? 'silly' : 'debug',
      levels,
      transports: [transport],
    }),
  }
}

describe('reading a winston level', () => {
  it.each([
    ['error', 'error'],
    ['warn', 'warn'],
    ['info', 'info'],
    ['http', 'debug'],
    ['verbose', 'debug'],
    ['debug', 'debug'],
    ['silly', 'trace'],
  ])('reads the npm level %s as %s', (named, expected) => {
    expect(levelOf(named)).toBe(expected)
  })

  it.each([
    ['emerg', 'fatal'],
    ['alert', 'fatal'],
    ['crit', 'fatal'],
    ['warning', 'warn'],
    ['notice', 'info'],
  ])('reads the syslog level %s as %s', (named, expected) => {
    expect(levelOf(named)).toBe(expected)
  })

  it.each([undefined, null, 42, 'nonsense'])('falls back to info for %j', (value) => {
    expect(levelOf(value)).toBe('info')
  })
})

describe('reading an error winston formatted', () => {
  it('rebuilds it from the stack', () => {
    const error = errorOf({
      message: 'card is undefined',
      stack: 'TypeError: card is undefined\n    at x',
    })

    expect(error?.name).toBe('TypeError')
    expect(error?.message).toBe('card is undefined')
    expect(error?.stack).toContain('at x')
  })

  it.each([undefined, '', 42])('finds none for a stack of %j', (stack) => {
    expect(errorOf({ message: 'x', stack })).toBeUndefined()
  })

  it('does not take a sentence as the error name', () => {
    const error = errorOf({
      message: 'x',
      stack: 'the payment gateway said no: try again later\n    at x',
    })

    expect(error?.name).toBe('Error')
    expect(error?.message).toBe('try again later')
  })

  it('keeps the whole first line when there is no name at all', () => {
    const error = errorOf({ message: 'x', stack: 'something went wrong\n    at x' })

    expect(error?.name).toBe('Error')
    expect(error?.message).toBe('something went wrong')
  })
})

describe('what becomes an attribute', () => {
  it('is everything that is not winston own bookkeeping', () => {
    expect(
      attributesOf({ level: 'info', message: 'x', orderId: 'ord_7' }, WINSTON_OWN_FIELDS),
    ).toEqual({ orderId: 'ord_7' })
  })
})

describe('a real winston logger with the transport added', () => {
  it('sends the line through', () => {
    const { events, log } = app()

    log.info('order created', { orderId: 'ord_7' })

    expect(events[0]?.level).toBe('info')
    expect(events[0]?.message).toBe('order created')
    expect(events[0]?.attributes?.orderId).toBe('ord_7')
  })

  it('keeps the level winston chose', () => {
    const { events, log } = app()

    log.silly('quiet')
    log.warn('loud')
    log.error('louder')

    expect(events.map((event) => event.level)).toEqual(['trace', 'warn', 'error'])
  })

  it('carries the error, with the line winston built kept beside it', () => {
    const { events, log } = app()

    log.error('payment failed', new TypeError('card is undefined'))

    expect(events[0]?.error?.type).toBe('TypeError')
    expect(events[0]?.message).toBe('card is undefined')
    expect(events[0]?.attributes?.[MESSAGE_ATTRIBUTE]).toBe('payment failed card is undefined')
  })

  it('carries what a child logger added', () => {
    const { events, log } = app()

    log.child({ requestId: 'req_7' }).info('inside the request')

    expect(events[0]?.attributes?.requestId).toBe('req_7')
  })

  it('understands syslog levels when the app uses them', () => {
    const { events, log } = app(winston.config.syslog.levels)

    log.log('crit', 'the disk is gone')

    expect(events[0]?.level).toBe('fatal')
  })
})

describe('a logger that fails underneath', () => {
  it('is reported and the chain carries on, instead of taking winston down', () => {
    const seen: unknown[] = []
    const transport = new NekologTransport({
      logger: {
        log: () => {
          throw new Error('the logger gave up')
        },
      } as never,
      onError: (error) => seen.push(error),
    })
    let continued = false

    transport.log({ level: 'info', message: 'x' }, () => {
      continued = true
    })

    expect(continued).toBe(true)
    expect(String(seen[0])).toContain('the logger gave up')
  })
})

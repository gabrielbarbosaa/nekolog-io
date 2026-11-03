import { createLogger, type LogEvent, memorySink } from '@nekolog-io/core'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import {
  attributesOf,
  errorOf,
  levelOf,
  MESSAGE_ATTRIBUTE,
  nekologDestination,
  PINO_OWN_FIELDS,
} from './index.ts'

function watching(options: Parameters<typeof nekologDestination>[1] = {}): {
  events: LogEvent[]
  destination: ReturnType<typeof nekologDestination>
} {
  const sink = memorySink()
  const logger = createLogger({ sink, level: 'trace' })
  return { events: sink.events, destination: nekologDestination(logger, options) }
}

describe('reading a pino level', () => {
  it.each([
    [10, 'trace'],
    [20, 'debug'],
    [30, 'info'],
    [40, 'warn'],
    [50, 'error'],
    [60, 'fatal'],
    [35, 'info'],
    [70, 'fatal'],
  ])('reads %i as %s', (value, expected) => {
    expect(levelOf(value)).toBe(expected)
  })

  it.each(['info', 'ERROR', 'fatal', 'trace'])('reads the name %j too', (named) => {
    expect(levelOf(named)).toBe(named.toLowerCase())
  })

  it.each([undefined, null, {}, Number.NaN, 'nonsense'])('falls back to info for %j', (value) => {
    expect(levelOf(value)).toBe('info')
  })
})

describe('reading a pino error', () => {
  it('rebuilds the error pino serialised', () => {
    const error = errorOf({
      err: { type: 'TypeError', message: 'card is undefined', stack: 'at x' },
    })

    expect(error?.name).toBe('TypeError')
    expect(error?.message).toBe('card is undefined')
    expect(error?.stack).toBe('at x')
  })

  it.each([undefined, null, 'a string', 42])('finds none in %j', (err) => {
    expect(errorOf({ err })).toBeUndefined()
  })
})

describe('what becomes an attribute', () => {
  it('is everything that is not pino own bookkeeping', () => {
    const attributes = attributesOf(
      { level: 30, time: 1, msg: 'x', orderId: 'ord_7', pid: 42 },
      PINO_OWN_FIELDS,
    )

    expect(attributes).toEqual({ orderId: 'ord_7', pid: 42 })
  })
})

describe('a real pino logger writing into it', () => {
  it('sends the line through', async () => {
    const { events, destination } = watching()
    const log = pino({ level: 'trace' }, destination)

    log.info({ orderId: 'ord_7' }, 'order created')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events[0]?.level).toBe('info')
    expect(events[0]?.message).toBe('order created')
    expect(events[0]?.attributes?.orderId).toBe('ord_7')
  })

  it('keeps the level pino chose', async () => {
    const { events, destination } = watching()
    const log = pino({ level: 'trace' }, destination)

    log.trace('quiet')
    log.warn('loud')
    log.fatal('the loudest')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events.map((event) => event.level)).toEqual(['trace', 'warn', 'fatal'])
  })

  it('carries the error, not only its message', async () => {
    const { events, destination } = watching()
    const log = pino({ level: 'trace' }, destination)

    log.error(new TypeError('card is undefined'), 'payment failed')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events[0]?.message).toBe('card is undefined')
    expect(events[0]?.error?.type).toBe('TypeError')
    expect(events[0]?.error?.stack).toContain('TypeError')
    expect(events[0]?.attributes?.[MESSAGE_ATTRIBUTE]).toBe('payment failed')
  })

  it('carries the bindings a child logger added', async () => {
    const { events, destination } = watching()
    const log = pino({ level: 'trace' }, destination).child({ requestId: 'req_7' })

    log.info('inside the request')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events[0]?.attributes?.requestId).toBe('req_7')
  })

  it('reads lines that arrive split across writes', async () => {
    const { events, destination } = watching()

    destination.write('{"level":30,"msg":"fir')
    destination.write('st"}\n{"level":40,"msg":"second"}\n')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events.map((event) => event.message)).toEqual(['first', 'second'])
  })

  it('reads the last line when the stream ends without a newline', async () => {
    const { events, destination } = watching()

    destination.write('{"level":30,"msg":"the last one"}')
    await new Promise<void>((resolve) => destination.end(resolve))

    expect(events[0]?.message).toBe('the last one')
  })
})

describe('a line that is not a line', () => {
  it('is reported and skipped, not thrown', async () => {
    const seen: unknown[] = []
    const { events, destination } = watching({ onError: (error) => seen.push(error) })

    destination.write('not json at all\n{"level":30,"msg":"still fine"}\n')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(seen).toHaveLength(1)
    expect(events.map((event) => event.message)).toEqual(['still fine'])
  })

  it.each(['[]\n', '"a string"\n', '42\n', 'null\n'])('skips %j without a word', async (text) => {
    const seen: unknown[] = []
    const { events, destination } = watching({ onError: (error) => seen.push(error) })

    destination.write(text)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events).toEqual([])
    expect(seen).toEqual([])
  })

  it('does not buffer forever when nothing ever ends the line', async () => {
    const seen: unknown[] = []
    const { destination } = watching({ onError: (error) => seen.push(error) })

    destination.write('{"level":30,"msg":"'.padEnd(2_000_000, 'x'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(String(seen[0])).toContain('longer than nekolog will buffer')
  })
})

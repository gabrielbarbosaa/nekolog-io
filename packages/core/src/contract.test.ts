import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '@internal/schema'
import { describe, expect, it } from 'vitest'
import * as limits from './limits.ts'
import { createLogger } from './logger.ts'
import { memorySink } from './sinks.ts'
import type { LogEvent } from './types.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

const packageJson = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
) as { name: string; version: string }

describe('the limits this package carries', () => {
  it.each([
    ['SCHEMA_VERSION', limits.SCHEMA_VERSION, schema.SCHEMA_VERSION],
    ['LOG_LEVELS', limits.LOG_LEVELS, schema.LOG_LEVELS],
    ['RUNTIMES', limits.RUNTIMES, schema.RUNTIMES],
    ['DEFAULT_SERVICE', limits.DEFAULT_SERVICE, schema.DEFAULT_SERVICE],
    ['MAX_SERVICE_CHARS', limits.MAX_SERVICE_CHARS, schema.MAX_SERVICE_CHARS],
    ['MAX_RELEASE_CHARS', limits.MAX_RELEASE_CHARS, schema.MAX_RELEASE_CHARS],
    ['MAX_SDK_NAME_CHARS', limits.MAX_SDK_NAME_CHARS, schema.MAX_SDK_NAME_CHARS],
    ['MAX_SDK_VERSION_CHARS', limits.MAX_SDK_VERSION_CHARS, schema.MAX_SDK_VERSION_CHARS],
    ['MAX_MESSAGE_BYTES', limits.MAX_MESSAGE_BYTES, schema.MAX_MESSAGE_BYTES],
    ['MAX_ATTRIBUTE_KEYS', limits.MAX_ATTRIBUTE_KEYS, schema.MAX_ATTRIBUTE_KEYS],
    ['MAX_ATTRIBUTE_KEY_CHARS', limits.MAX_ATTRIBUTE_KEY_CHARS, schema.MAX_ATTRIBUTE_KEY_CHARS],
    [
      'MAX_ATTRIBUTE_VALUE_BYTES',
      limits.MAX_ATTRIBUTE_VALUE_BYTES,
      schema.MAX_ATTRIBUTE_VALUE_BYTES,
    ],
    [
      'ATTRIBUTE_KEY_PATTERN',
      limits.ATTRIBUTE_KEY_PATTERN.source,
      schema.ATTRIBUTE_KEY_PATTERN.source,
    ],
    ['TRACE_ID_CHARS', limits.TRACE_ID_CHARS, schema.TRACE_ID_CHARS],
    ['SPAN_ID_CHARS', limits.SPAN_ID_CHARS, schema.SPAN_ID_CHARS],
    ['MAX_SESSION_ID_CHARS', limits.MAX_SESSION_ID_CHARS, schema.MAX_SESSION_ID_CHARS],
    ['MAX_USER_ID_CHARS', limits.MAX_USER_ID_CHARS, schema.MAX_USER_ID_CHARS],
    ['MAX_ERROR_TYPE_CHARS', limits.MAX_ERROR_TYPE_CHARS, schema.MAX_ERROR_TYPE_CHARS],
    ['MAX_ERROR_MESSAGE_BYTES', limits.MAX_ERROR_MESSAGE_BYTES, schema.MAX_ERROR_MESSAGE_BYTES],
    ['MAX_ERROR_STACK_BYTES', limits.MAX_ERROR_STACK_BYTES, schema.MAX_ERROR_STACK_BYTES],
    ['MAX_FINGERPRINT_ITEMS', limits.MAX_FINGERPRINT_ITEMS, schema.MAX_FINGERPRINT_ITEMS],
  ])('matches the ingest contract for %s', (_name, mine, theirs) => {
    expect(mine).toEqual(theirs)
  })
})

describe('the sdk version it reports', () => {
  it('matches the version in package.json', () => {
    expect(SDK_VERSION).toBe(packageJson.version)
  })

  it('matches the package name', () => {
    expect(SDK_NAME).toBe(packageJson.name)
  })
})

const BATCH_ID = '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10'

function envelopeFor(events: LogEvent[], logger: ReturnType<typeof createLogger>) {
  return {
    schemaVersion: limits.SCHEMA_VERSION,
    batchId: BATCH_ID,
    sdk: logger.sdk,
    resource: logger.resource,
    events,
  }
}

function acceptAll(events: LogEvent[], logger: ReturnType<typeof createLogger>) {
  const result = schema.parseBatch(envelopeFor(events, logger))
  if (!result.ok) {
    throw new Error(`The ingest API would reject the whole batch: ${result.message}`)
  }
  return result.batch
}

describe('events this logger produces, run through the real ingest parser', () => {
  it('accepts an ordinary log', () => {
    const sink = memorySink()
    const logger = createLogger({ sink, service: 'checkout-web', release: '1.4.2' })

    logger.info('Pedido criado', { orderId: 123, amount: 99.9, retry: true })

    const batch = acceptAll(sink.events, logger)
    expect(batch.rejected).toEqual([])
    expect(batch.accepted[0]?.event.attributes).toEqual({
      orderId: 123,
      amount: 99.9,
      retry: true,
    })
  })

  it('accepts an error with trace, session and fingerprint', () => {
    const sink = memorySink()
    const logger = createLogger({ sink, level: 'trace' })

    logger
      .child({
        trace: { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' },
        session: { id: 's_8f2k1', userId: 'u_42' },
        fingerprint: ['payment', 'gateway-timeout'],
      })
      .error(new TypeError('Cannot read properties of undefined'), { step: 'pagamento' })

    expect(acceptAll(sink.events, logger).rejected).toEqual([])
  })

  it('accepts one event per level', () => {
    const sink = memorySink()
    const logger = createLogger({ sink, level: 'trace' })

    for (const level of limits.LOG_LEVELS) {
      logger.log(level, `a ${level} line`)
    }

    const batch = acceptAll(sink.events, logger)
    expect(batch.accepted).toHaveLength(limits.LOG_LEVELS.length)
    expect(batch.rejected).toEqual([])
  })

  it('accepts a message far beyond the limit, because the sdk already cut it', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.info('x'.repeat(limits.MAX_MESSAGE_BYTES * 2))

    const batch = acceptAll(sink.events, logger)
    expect(batch.rejected).toEqual([])
    expect(batch.accepted[0]?.messageTruncated).toBe(false)
  })

  it('accepts hostile attribute keys, because the sdk already sanitised them', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.info('hello', { 'bad key!': 1, 'nested obj': { 'worse/key': 2 } })

    expect(acceptAll(sink.events, logger).rejected).toEqual([])
  })

  it('accepts an attribute value far beyond the limit', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.info('hello', { big: 'x'.repeat(limits.MAX_ATTRIBUTE_VALUE_BYTES * 2) })

    expect(acceptAll(sink.events, logger).rejected).toEqual([])
  })

  it('accepts more attributes than the contract allows, because the sdk already capped them', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })
    const wide: Record<string, number> = {}
    for (let i = 0; i < limits.MAX_ATTRIBUTE_KEYS * 2; i++) {
      wide[`k${i}`] = i
    }

    logger.info('hello', wide)

    expect(acceptAll(sink.events, logger).rejected).toEqual([])
  })

  it('accepts an error whose stack is longer than the contract allows', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })
    const failure = new Error('boom')
    failure.stack = 'x'.repeat(limits.MAX_ERROR_STACK_BYTES * 2)

    logger.error(failure)

    expect(acceptAll(sink.events, logger).rejected).toEqual([])
  })

  it('drops a malformed trace rather than sending one the api would reject', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.child({ trace: { traceId: 'too-short', spanId: 'nope' } }).info('hello')

    expect(sink.events[0]).not.toHaveProperty('trace')
    expect(acceptAll(sink.events, logger).rejected).toEqual([])
  })

  it('never sends an empty message, which the api rejects', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    logger.info('')

    expect(sink.events[0]?.message).not.toBe('')
    expect(acceptAll(sink.events, logger).rejected).toEqual([])
  })
})

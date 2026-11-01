import * as schema from '@internal/schema'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import * as limits from './limits.ts'
import { createLogger } from './logger.ts'
import { memorySink } from './sinks.ts'
import type { LogEvent } from './types.ts'
import { uuidv7 } from './uuid.ts'

const RUNS = Number(process.env.FUZZ_RUNS ?? 300)

const hostileText = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.string({ unit: 'binary', maxLength: 120 }),
  fc.string({ unit: 'grapheme', maxLength: 60 }),
  fc.constantFrom('', ' ', '\u0000', '\ud800', '\udfff', '🙂'.repeat(40), 'x'.repeat(40_000)),
)

const hostileKey = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom(
    '',
    'a b',
    'chave com acento ç',
    'x'.repeat(limits.MAX_ATTRIBUTE_KEY_CHARS * 2),
    '__proto__',
    'constructor',
    'toString',
    'a'.repeat(5),
  ),
)

const hostileValue = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0),
  fc.array(fc.string({ maxLength: 10 }), { maxLength: 4 }),
  fc.record({ nested: fc.record({ deeper: fc.string({ maxLength: 10 }) }) }),
  fc.date({ noInvalidDate: true }),
  fc.constant(() => undefined),
  fc.constant(Symbol('s')),
)

const attributes = fc.dictionary(hostileKey, hostileValue, { maxKeys: 12 })

const level = fc.constantFrom(...limits.LOG_LEVELS)

function envelopeFor(events: LogEvent[], logger: ReturnType<typeof createLogger>) {
  return {
    schemaVersion: limits.SCHEMA_VERSION,
    batchId: uuidv7(),
    sdk: logger.sdk,
    resource: logger.resource,
    events,
  }
}

function expectAccepted(events: LogEvent[], logger: ReturnType<typeof createLogger>): void {
  if (events.length === 0) {
    return
  }
  const result = schema.parseBatch(envelopeFor(events, logger))

  if (!result.ok) {
    throw new Error(`the ingest API would refuse the whole batch: ${result.message}`)
  }
  if (result.batch.rejected.length > 0) {
    throw new Error(
      `the ingest API would refuse ${result.batch.rejected.length} event(s): ${JSON.stringify(result.batch.rejected)}`,
    )
  }
}

describe('whatever the sdk is asked to log, the ingest parser accepts it', () => {
  it('for a message and attributes of any shape', () => {
    fc.assert(
      fc.property(level, hostileText, attributes, (chosen, message, extra) => {
        const sink = memorySink()
        const logger = createLogger({ sink, level: 'trace' })

        logger[chosen](message, extra as Record<string, unknown>)

        expectAccepted(sink.events, logger)
      }),
      { numRuns: RUNS },
    )
  })

  it('for an Error with any name, message and stack', () => {
    fc.assert(
      fc.property(hostileText, hostileText, hostileText, (name, message, stack) => {
        const sink = memorySink()
        const logger = createLogger({ sink, level: 'trace' })
        const failure = new Error(message)
        failure.name = name
        failure.stack = stack

        logger.error(failure)

        expectAccepted(sink.events, logger)
      }),
      { numRuns: RUNS },
    )
  })

  it('for context carried down through child loggers', () => {
    fc.assert(
      fc.property(attributes, attributes, hostileText, (parent, child, message) => {
        const sink = memorySink()
        const logger = createLogger({ sink, level: 'trace' })

        logger
          .child(parent as Record<string, unknown>)
          .child(child as Record<string, unknown>)
          .warn(message)

        expectAccepted(sink.events, logger)
      }),
      { numRuns: RUNS },
    )
  })

  it('for a service and a release of any shape', () => {
    fc.assert(
      fc.property(hostileText, hostileText, hostileText, (service, release, message) => {
        const sink = memorySink()
        const logger = createLogger({ sink, level: 'trace', service, release })

        logger.info(message)

        expectAccepted(sink.events, logger)
      }),
      { numRuns: RUNS },
    )
  })

  it('for a whole batch of mixed events at once', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(level, hostileText, attributes), { minLength: 1, maxLength: 12 }),
        (calls) => {
          const sink = memorySink()
          const logger = createLogger({ sink, level: 'trace' })

          for (const [chosen, message, extra] of calls) {
            logger[chosen](message, extra as Record<string, unknown>)
          }

          expectAccepted(sink.events, logger)
        },
      ),
      { numRuns: RUNS },
    )
  })

  it('never throws into the host application, whatever it is handed', () => {
    fc.assert(
      fc.property(level, fc.anything(), fc.anything(), (chosen, message, extra) => {
        const sink = memorySink()
        const logger = createLogger({ sink, level: 'trace' })

        expect(() => {
          logger[chosen](message as string, extra as Record<string, unknown>)
        }).not.toThrow()
      }),
      { numRuns: RUNS },
    )
  })

  it('produces events the parser accepts even from values it was never meant to take', () => {
    fc.assert(
      fc.property(fc.anything(), (anything) => {
        const sink = memorySink()
        const logger = createLogger({ sink, level: 'trace' })

        logger.info(anything as string)

        expectAccepted(sink.events, logger)
      }),
      { numRuns: RUNS },
    )
  })
})

describe('the fuzzer itself', () => {
  it('actually produces events, so the properties above are not vacuous', () => {
    let produced = 0
    let withAttributes = 0

    fc.assert(
      fc.property(level, hostileText, attributes, (chosen, message, extra) => {
        const sink = memorySink()
        const logger = createLogger({ sink, level: 'trace' })
        logger[chosen](message, extra as Record<string, unknown>)

        produced += sink.events.length
        if (Object.keys(sink.events[0]?.attributes ?? {}).length > 0) {
          withAttributes += 1
        }
      }),
      { numRuns: RUNS },
    )

    expect(produced).toBe(RUNS)
    expect(withAttributes).toBeGreaterThan(RUNS * 0.2)
  })
})

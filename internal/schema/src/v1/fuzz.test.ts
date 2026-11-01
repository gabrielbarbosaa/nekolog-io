import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BATCH_ERROR_CODES, EVENT_REJECTION_CODES } from './codes.ts'
import {
  ATTRIBUTE_KEY_PATTERN,
  LOG_LEVELS,
  MAX_ATTRIBUTE_KEY_CHARS,
  MAX_ATTRIBUTE_KEYS,
  MAX_ATTRIBUTE_VALUE_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE_BYTES,
  MIN_EVENTS_PER_BATCH,
  RUNTIMES,
  SPAN_ID_CHARS,
  TRACE_ID_CHARS,
} from './limits.ts'
import { type ParseResult, parseBatch } from './parse.ts'

const RUNS = Number(process.env.FUZZ_RUNS ?? 400)

const encoder = new TextEncoder()

function bytes(value: string): number {
  return encoder.encode(value).length
}

function characters(alphabet: string, max: number) {
  return fc
    .array(fc.constantFrom(...alphabet.split('')), { minLength: 1, maxLength: max })
    .map((items) => items.join(''))
}

const hex = (length: number) =>
  fc
    .array(fc.constantFrom(...'0123456789abcdef'.split('')), {
      minLength: length,
      maxLength: length,
    })
    .map((items) => items.join(''))

const attributeKey = characters('abzABZ019_.-', 24)

const attributeValue = fc.oneof(
  fc.string({ maxLength: 64 }),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
)

const anEvent = fc.record(
  {
    timestamp: fc
      .date({
        min: new Date('2000-01-01T00:00:00.000Z'),
        max: new Date('2100-01-01T00:00:00.000Z'),
        noInvalidDate: true,
      })
      .map((date) => date.toISOString()),
    level: fc.constantFrom(...LOG_LEVELS),
    message: fc.string({ maxLength: 200 }),
    attributes: fc.option(fc.dictionary(attributeKey, attributeValue, { maxKeys: 8 }), {
      nil: undefined,
    }),
    trace: fc.option(fc.record({ traceId: hex(TRACE_ID_CHARS), spanId: hex(SPAN_ID_CHARS) }), {
      nil: undefined,
    }),
    session: fc.option(
      fc.record({ id: fc.string({ maxLength: 20 }), userId: fc.string({ maxLength: 20 }) }),
      { nil: undefined },
    ),
    error: fc.option(
      fc.record({
        type: fc.string({ maxLength: 30 }),
        message: fc.string({ maxLength: 60 }),
        stack: fc.string({ maxLength: 200 }),
      }),
      { nil: undefined },
    ),
    fingerprint: fc.option(fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: ['timestamp', 'level', 'message'] },
)

const anEnvelope = fc.record(
  {
    schemaVersion: fc.constant(1),
    batchId: fc.uuid({ version: 7 }),
    sdk: fc.record({
      name: characters('abz-@/', 20),
      version: characters('012.', 8),
    }),
    resource: fc.record(
      {
        service: fc.option(characters('abz-019', 20), { nil: undefined }),
        release: fc.option(characters('abz-019.', 10), { nil: undefined }),
        runtime: fc.constantFrom(...RUNTIMES),
      },
      { requiredKeys: ['runtime'] },
    ),
    events: fc.array(anEvent, { minLength: MIN_EVENTS_PER_BATCH, maxLength: 6 }),
  },
  { requiredKeys: ['schemaVersion', 'batchId', 'sdk', 'resource', 'events'] },
)

function corrupt(payload: unknown, path: string[], replacement: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(payload))
  let cursor = copy
  for (const step of path.slice(0, -1)) {
    if (typeof cursor !== 'object' || cursor === null) {
      return copy
    }
    cursor = cursor[step]
  }
  const last = path[path.length - 1]
  if (typeof cursor === 'object' && cursor !== null && last !== undefined) {
    cursor[last] = replacement
  }
  return copy
}

const anEventField = fc.constantFrom(
  ['events', '0', 'level'],
  ['events', '0', 'timestamp'],
  ['events', '0', 'message'],
  ['events', '0', 'attributes'],
  ['events', '0', 'trace'],
  ['events', '0', 'session'],
  ['events', '0', 'error'],
  ['events', '0', 'fingerprint'],
)

const anEnvelopeField = fc.constantFrom(
  ['schemaVersion'],
  ['batchId'],
  ['sdk'],
  ['sdk', 'name'],
  ['resource'],
  ['resource', 'runtime'],
  ['events'],
  ['events', '0'],
)

const corruptedAt = (field: fc.Arbitrary<ReadonlyArray<string>>) =>
  fc
    .tuple(anEnvelope, field, fc.jsonValue())
    .map(([envelope, path, replacement]) => corrupt(envelope, [...path], replacement))

const aCorruptedEnvelope = fc.oneof(
  { arbitrary: anEnvelope as fc.Arbitrary<unknown>, weight: 4 },
  { arbitrary: corruptedAt(anEventField), weight: 5 },
  { arbitrary: corruptedAt(anEnvelopeField), weight: 2 },
)

function expectWellFormed(result: ParseResult, events: number): void {
  if (!result.ok) {
    expect(BATCH_ERROR_CODES).toContain(result.code)
    expect(typeof result.message).toBe('string')
    return
  }

  const { accepted, rejected } = result.batch
  expect(accepted.length + rejected.length).toBe(events)

  const indices = [...accepted.map((entry) => entry.index), ...rejected.map((entry) => entry.index)]
  expect(new Set(indices).size).toBe(indices.length)
  expect([...indices].sort((a, b) => a - b)).toEqual(
    Array.from({ length: events }, (_, index) => index),
  )

  for (const entry of rejected) {
    expect(EVENT_REJECTION_CODES).toContain(entry.code)
  }
}

describe('the fuzzer itself', () => {
  it('reaches every outcome that matters, so the properties below are not vacuous', () => {
    let accepted = 0
    let refused = 0
    let withRejectedEvents = 0
    let withAcceptedEvents = 0

    fc.assert(
      fc.property(aCorruptedEnvelope, (payload) => {
        const result = parseBatch(payload)
        if (!result.ok) {
          refused += 1
          return
        }
        accepted += 1
        if (result.batch.rejected.length > 0) {
          withRejectedEvents += 1
        }
        if (result.batch.accepted.length > 0) {
          withAcceptedEvents += 1
        }
      }),
      { numRuns: RUNS },
    )

    expect(accepted).toBeGreaterThan(RUNS * 0.1)
    expect(refused).toBeGreaterThan(RUNS * 0.05)
    expect(withRejectedEvents).toBeGreaterThan(0)
    expect(withAcceptedEvents).toBeGreaterThan(0)
  })
})

describe('parseBatch, fuzzed', () => {
  it('never throws, whatever JSON arrives', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        expect(() => parseBatch(input)).not.toThrow()
      }),
      { numRuns: RUNS },
    )
  })

  it('never throws on values JSON cannot even carry', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => parseBatch(input)).not.toThrow()
      }),
      { numRuns: RUNS },
    )
  })

  it('answers with a stable code when it refuses', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        const result = parseBatch(input)
        if (!result.ok) {
          expect(BATCH_ERROR_CODES).toContain(result.code)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('splits the events into accepted and rejected, losing none and counting none twice', () => {
    fc.assert(
      fc.property(anEnvelope, (envelope) => {
        expectWellFormed(parseBatch(envelope), envelope.events.length)
      }),
      { numRuns: RUNS },
    )
  })

  it('keeps that promise even when a field has been corrupted', () => {
    fc.assert(
      fc.property(aCorruptedEnvelope, (payload) => {
        const events = (payload as { events?: unknown }).events
        const result = parseBatch(payload)
        if (result.ok && Array.isArray(events)) {
          expectWellFormed(result, events.length)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('never accepts an event that breaks a documented limit', () => {
    fc.assert(
      fc.property(aCorruptedEnvelope, (payload) => {
        const result = parseBatch(payload)
        if (!result.ok) {
          return
        }

        for (const { event } of result.batch.accepted) {
          expect(LOG_LEVELS).toContain(event.level)
          expect(typeof event.message).toBe('string')
          expect(bytes(event.message)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES)

          const attributes = event.attributes ?? {}
          expect(Object.keys(attributes).length).toBeLessThanOrEqual(MAX_ATTRIBUTE_KEYS)
          for (const [key, value] of Object.entries(attributes)) {
            expect(key.length).toBeLessThanOrEqual(MAX_ATTRIBUTE_KEY_CHARS)
            expect(ATTRIBUTE_KEY_PATTERN.test(key)).toBe(true)
            if (typeof value === 'string') {
              expect(bytes(value)).toBeLessThanOrEqual(MAX_ATTRIBUTE_VALUE_BYTES)
            } else {
              expect(['number', 'boolean', 'object']).toContain(typeof value)
            }
          }

          if (event.trace !== undefined) {
            expect(event.trace.traceId).toMatch(/^[0-9a-f]{32}$/)
            expect(event.trace.spanId).toMatch(/^[0-9a-f]{16}$/)
          }
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('never accepts a batch with more events than the contract allows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_EVENTS_PER_BATCH + 1, max: MAX_EVENTS_PER_BATCH + 5 }),
        (count) => {
          const event = {
            timestamp: '2026-11-01T12:00:00.000Z',
            level: 'info',
            message: 'hello',
          }
          const result = parseBatch({
            schemaVersion: 1,
            batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
            sdk: { name: 'x', version: '1' },
            resource: { runtime: 'node' },
            events: Array.from({ length: count }, () => event),
          })

          expect(result.ok).toBe(false)
        },
      ),
      { numRuns: 20 },
    )
  })

  it('gives the same verdict before and after a trip through JSON', () => {
    fc.assert(
      fc.property(aCorruptedEnvelope, (payload) => {
        const direct = parseBatch(payload)
        const roundTripped = parseBatch(JSON.parse(JSON.stringify(payload)))

        expect(roundTripped.ok).toBe(direct.ok)
        if (direct.ok && roundTripped.ok) {
          expect(roundTripped.batch.accepted.map((entry) => entry.index)).toEqual(
            direct.batch.accepted.map((entry) => entry.index),
          )
          expect(roundTripped.batch.rejected).toEqual(direct.batch.rejected)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('ignores a field it has never heard of, so a newer SDK still works', () => {
    fc.assert(
      fc.property(anEnvelope, fc.jsonValue(), (envelope, extra) => {
        const before = parseBatch(envelope)
        const after = parseBatch({
          ...envelope,
          somethingNewerSdksSend: extra,
          events: envelope.events.map((event) => ({ ...event, alsoNew: extra })),
        })

        expect(after.ok).toBe(before.ok)
        if (before.ok && after.ok) {
          expect(after.batch.accepted.length).toBe(before.batch.accepted.length)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('truncates a long message honestly, or leaves it exactly as it came', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 400 }),
        fc.integer({ min: 1, max: 80 }),
        (chunk, repeats) => {
          const message = chunk.repeat(repeats)
          const result = parseBatch({
            schemaVersion: 1,
            batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
            sdk: { name: 'x', version: '1' },
            resource: { runtime: 'node' },
            events: [{ timestamp: '2026-11-01T12:00:00.000Z', level: 'info', message }],
          })

          if (!result.ok) {
            return
          }
          const accepted = result.batch.accepted[0]
          if (accepted === undefined) {
            return
          }

          expect(bytes(accepted.event.message)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES)
          expect(message.startsWith(accepted.event.message)).toBe(true)
          expect(accepted.messageTruncated).toBe(accepted.event.message !== message)
        },
      ),
      { numRuns: RUNS },
    )
  })

  it('never invents a level or a message that was not sent', () => {
    fc.assert(
      fc.property(anEnvelope, (envelope) => {
        const result = parseBatch(envelope)
        if (!result.ok) {
          return
        }
        for (const accepted of result.batch.accepted) {
          const original = envelope.events[accepted.index]
          expect(accepted.event.level).toBe(original?.level)
          if (!accepted.messageTruncated) {
            expect(accepted.event.message).toBe(original?.message)
          }
        }
      }),
      { numRuns: RUNS },
    )
  })
})

import { describe, expect, it } from 'vitest'
import {
  MAX_ATTRIBUTE_KEYS,
  MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE_BYTES,
  MAX_SERVICE_CHARS,
} from './limits.ts'
import { exceedsBatchSizeLimit, parseBatch } from './parse.ts'
import { utf8ByteLength } from './utf8.ts'

const VALID_EVENT = {
  timestamp: '2026-10-29T14:03:12.481Z',
  level: 'error',
  message: 'Payment failed',
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    sdk: { name: '@nekolog-io/browser', version: '0.3.0' },
    resource: { service: 'checkout-web', release: '1.4.2', runtime: 'browser' },
    events: [VALID_EVENT],
    ...overrides,
  }
}

function expectOk(result: ReturnType<typeof parseBatch>) {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.code}: ${result.message}`)
  }
  return result.batch
}

describe('parseBatch, the example from the specification', () => {
  it('accepts it verbatim', () => {
    const result = parseBatch({
      schemaVersion: 1,
      batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
      sdk: { name: '@nekolog-io/browser', version: '0.3.0' },
      resource: { service: 'checkout-web', release: '1.4.2', runtime: 'browser' },
      events: [
        {
          timestamp: '2026-10-29T14:03:12.481Z',
          level: 'error',
          message: 'Payment failed',
          attributes: { orderId: '123', amount: 99.9, retry: true },
          trace: {
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
          },
          session: { id: 's_8f2k1', userId: 'u_42' },
          error: {
            type: 'TypeError',
            message: 'Cannot read properties of undefined',
            stack: 'at x',
          },
          fingerprint: ['payment', 'gateway-timeout'],
        },
      ],
    })

    const parsed = expectOk(result)
    expect(parsed.accepted).toHaveLength(1)
    expect(parsed.rejected).toEqual([])
    expect(parsed.accepted[0]?.event.attributes).toEqual({
      orderId: '123',
      amount: 99.9,
      retry: true,
    })
  })
})

describe('parseBatch, a bad event does not sink the batch', () => {
  it('keeps the valid events and reports the invalid one by index', () => {
    const result = parseBatch(
      batch({
        events: [
          VALID_EVENT,
          { ...VALID_EVENT, level: 'critical' },
          VALID_EVENT,
          { ...VALID_EVENT, timestamp: 'ontem' },
        ],
      }),
    )

    const parsed = expectOk(result)
    expect(parsed.accepted.map((a) => a.index)).toEqual([0, 2])
    expect(parsed.rejected).toEqual([
      { index: 1, code: 'invalid_level' },
      { index: 3, code: 'invalid_timestamp' },
    ])
  })

  it('reports a rejection code naming the offending field', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ level: 'nope' }, 'invalid_level'],
      [{ timestamp: '2026-10-29T14:03:12Z' }, 'invalid_timestamp'],
      [{ message: '' }, 'invalid_message'],
      [{ attributes: { 'bad key!': 'x' } }, 'invalid_attributes'],
      [{ trace: { traceId: 'short', spanId: '00f067aa0ba902b7' } }, 'invalid_trace'],
      [{ session: { id: 'a'.repeat(65) } }, 'invalid_session'],
      [{ error: { type: 'a'.repeat(257) } }, 'invalid_error'],
      [{ fingerprint: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'invalid_fingerprint'],
    ]

    for (const [override, code] of cases) {
      const parsed = expectOk(parseBatch(batch({ events: [{ ...VALID_EVENT, ...override }] })))
      expect(parsed.rejected, JSON.stringify(override)).toEqual([{ index: 0, code }])
    }
  })

  it('rejects every event without failing the batch itself', () => {
    const parsed = expectOk(parseBatch(batch({ events: [{ level: 'nope' }, { level: 'nope' }] })))
    expect(parsed.accepted).toEqual([])
    expect(parsed.rejected).toHaveLength(2)
  })
})

describe('parseBatch, envelope failures reject the whole batch', () => {
  it('names unsupported schema versions with their own code', () => {
    const result = parseBatch(batch({ schemaVersion: 99 }))
    expect(result).toMatchObject({ ok: false, code: 'unsupported_schema_version' })
  })

  it('does not mistake a bad batchId for a version problem', () => {
    const result = parseBatch(batch({ batchId: 'not-a-uuid' }))
    expect(result).toMatchObject({ ok: false, code: 'invalid_payload' })
  })

  it('requires a UUID v7, not just any UUID', () => {
    const v4 = parseBatch(batch({ batchId: '9f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d' }))
    expect(v4).toMatchObject({ ok: false, code: 'invalid_payload' })
  })

  it('rejects a non-object body', () => {
    for (const body of [null, 'texto', 42, [], undefined]) {
      expect(parseBatch(body)).toMatchObject({ ok: false, code: 'invalid_payload' })
    }
  })

  it('rejects an empty event list', () => {
    expect(parseBatch(batch({ events: [] }))).toMatchObject({
      ok: false,
      code: 'invalid_payload',
    })
  })

  it(`rejects more than ${MAX_EVENTS_PER_BATCH} events`, () => {
    const tooMany = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => VALID_EVENT)
    expect(parseBatch(batch({ events: tooMany }))).toMatchObject({
      ok: false,
      code: 'invalid_payload',
    })
  })

  it(`accepts exactly ${MAX_EVENTS_PER_BATCH} events`, () => {
    const atLimit = Array.from({ length: MAX_EVENTS_PER_BATCH }, () => VALID_EVENT)
    expect(expectOk(parseBatch(batch({ events: atLimit }))).accepted).toHaveLength(
      MAX_EVENTS_PER_BATCH,
    )
  })

  it('rejects an unknown runtime', () => {
    expect(parseBatch(batch({ resource: { runtime: 'perl' } }))).toMatchObject({
      ok: false,
      code: 'invalid_payload',
    })
  })
})

describe('parseBatch, long messages are truncated rather than rejected', () => {
  it('truncates at the byte limit and flags it', () => {
    const long = 'a'.repeat(MAX_MESSAGE_BYTES + 500)
    const parsed = expectOk(parseBatch(batch({ events: [{ ...VALID_EVENT, message: long }] })))

    expect(parsed.rejected).toEqual([])
    const accepted = parsed.accepted[0]
    expect(accepted?.messageTruncated).toBe(true)
    expect(utf8ByteLength(accepted?.event.message ?? '')).toBeLessThanOrEqual(MAX_MESSAGE_BYTES)
  })

  it('does not flag a message that fits', () => {
    const parsed = expectOk(parseBatch(batch()))
    expect(parsed.accepted[0]?.messageTruncated).toBe(false)
    expect(parsed.accepted[0]?.event.message).toBe('Payment failed')
  })

  it('measures the limit in bytes, not characters', () => {
    const multibyte = 'é'.repeat(MAX_MESSAGE_BYTES)
    const parsed = expectOk(parseBatch(batch({ events: [{ ...VALID_EVENT, message: multibyte }] })))
    expect(parsed.accepted[0]?.messageTruncated).toBe(true)
    expect(utf8ByteLength(parsed.accepted[0]?.event.message ?? '')).toBeLessThanOrEqual(
      MAX_MESSAGE_BYTES,
    )
  })
})

describe('parseBatch, normalisation', () => {
  it('defaults the service when omitted', () => {
    const parsed = expectOk(parseBatch(batch({ resource: { runtime: 'node' } })))
    expect(parsed.resource.service).toBe('default')
  })

  it('keeps an explicit service', () => {
    expect(expectOk(parseBatch(batch())).resource.service).toBe('checkout-web')
  })

  it('drops unknown fields so newer SDKs keep working', () => {
    const parsed = expectOk(
      parseBatch(
        batch({
          futureField: 'ignored',
          events: [{ ...VALID_EVENT, futureEventField: 'ignored' }],
        }),
      ),
    )
    expect(parsed).not.toHaveProperty('futureField')
    expect(parsed.accepted[0]?.event).not.toHaveProperty('futureEventField')
  })
})

describe('parseBatch, attribute limits', () => {
  it(`accepts exactly ${MAX_ATTRIBUTE_KEYS} keys`, () => {
    const attributes = Object.fromEntries(
      Array.from({ length: MAX_ATTRIBUTE_KEYS }, (_, i) => [`k${i}`, 'v']),
    )
    const parsed = expectOk(parseBatch(batch({ events: [{ ...VALID_EVENT, attributes }] })))
    expect(parsed.rejected).toEqual([])
  })

  it(`rejects ${MAX_ATTRIBUTE_KEYS + 1} keys`, () => {
    const attributes = Object.fromEntries(
      Array.from({ length: MAX_ATTRIBUTE_KEYS + 1 }, (_, i) => [`k${i}`, 'v']),
    )
    const parsed = expectOk(parseBatch(batch({ events: [{ ...VALID_EVENT, attributes }] })))
    expect(parsed.rejected).toEqual([{ index: 0, code: 'invalid_attributes' }])
  })

  it('accepts string, number, boolean and null values', () => {
    const parsed = expectOk(
      parseBatch(
        batch({
          events: [{ ...VALID_EVENT, attributes: { s: 'x', n: 1.5, b: false, nothing: null } }],
        }),
      ),
    )
    expect(parsed.rejected).toEqual([])
  })

  it('rejects nested objects, which the SDK is meant to flatten', () => {
    const parsed = expectOk(
      parseBatch(batch({ events: [{ ...VALID_EVENT, attributes: { user: { id: 1 } } }] })),
    )
    expect(parsed.rejected).toEqual([{ index: 0, code: 'invalid_attributes' }])
  })

  it('rejects NaN and Infinity, which do not survive JSON', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const parsed = expectOk(
        parseBatch(batch({ events: [{ ...VALID_EVENT, attributes: { n: value } }] })),
      )
      expect(parsed.rejected).toEqual([{ index: 0, code: 'invalid_attributes' }])
    }
  })
})

describe('parseBatch, character limits are characters', () => {
  it(`accepts a service of exactly ${MAX_SERVICE_CHARS} characters`, () => {
    const service = 'a'.repeat(MAX_SERVICE_CHARS)
    expect(
      expectOk(parseBatch(batch({ resource: { service, runtime: 'node' } }))).resource.service,
    ).toBe(service)
  })

  it(`rejects a service of ${MAX_SERVICE_CHARS + 1} characters`, () => {
    const service = 'a'.repeat(MAX_SERVICE_CHARS + 1)
    expect(parseBatch(batch({ resource: { service, runtime: 'node' } }))).toMatchObject({
      ok: false,
      code: 'invalid_payload',
    })
  })
})

describe('exceedsBatchSizeLimit', () => {
  it('allows a body exactly at 512 KB', () => {
    expect(exceedsBatchSizeLimit(512 * 1024)).toBe(false)
  })

  it('rejects one byte over', () => {
    expect(exceedsBatchSizeLimit(512 * 1024 + 1)).toBe(true)
  })
})

describe('a body that is not a JSON object at all', () => {
  it.each([
    ['an array', [] as unknown],
    ['a non-empty array', [{ schemaVersion: 1 }] as unknown],
    ['a string', 'hello' as unknown],
    ['a number', 42 as unknown],
    ['null', null as unknown],
    ['a boolean', true as unknown],
  ])('tells the sender plainly that %s is not a batch', (_what, body) => {
    const result = parseBatch(body)

    expect(result).toMatchObject({ ok: false, code: 'invalid_payload' })
    if (!result.ok) {
      expect(result.message).toBe('Body must be a JSON object')
    }
  })
})

describe('a value crafted so that converting it to text throws', () => {
  const hostile = () => JSON.parse('{"schemaVersion":{"toString":""}}')

  it('really would throw if it were coerced the naive way', () => {
    expect(() => String(hostile().schemaVersion)).toThrow(TypeError)
  })

  it('answers with the stable code instead of throwing out of the parser', () => {
    const result = parseBatch(hostile())

    expect(result).toMatchObject({ ok: false, code: 'unsupported_schema_version' })
  })

  it.each([
    ['an object', { toString: '' }, 'object'],
    ['an array', [1, 2], 'array'],
    ['null inside', null, undefined],
    ['a number', 99, '99'],
    ['a string', 'two', 'two'],
  ])('names %s in the message without ever coercing it blindly', (_what, version, expected) => {
    const result = parseBatch({ schemaVersion: version })

    if (expected !== undefined && !result.ok) {
      expect(result.message).toBe(`Unsupported schemaVersion: ${expected}`)
    }
    expect(result.ok).toBe(false)
  })

  it('never echoes back more of the sender text than it has to', () => {
    const result = parseBatch({ schemaVersion: 'x'.repeat(5_000) })

    if (!result.ok) {
      expect(result.message.length).toBeLessThan(80)
    }
  })
})

import { parseBatch, uuidv7 } from '@internal/schema'
import { describe, expect, it } from 'vitest'
import {
  anyValue,
  attributesFrom,
  bodyText,
  DEFAULT_RUNTIME,
  DEFAULT_SERVICE,
  levelFor,
  MAX_OTLP_BODY_CHARS,
  MAX_OTLP_RECORDS,
  millisFrom,
  OTLP_SEVERITY_LEVELS,
  OtlpError,
  translateOtlp,
} from './otlp.ts'

const AT = Date.UTC(2026, 10, 4, 12, 0, 0)
const NANOS = String(BigInt(AT) * 1000000n)

function payload(records: Array<Record<string, unknown>>, resource?: unknown) {
  return {
    resourceLogs: [
      {
        resource: resource ?? {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout-api' } },
            { key: 'service.version', value: { stringValue: '1.4.2' } },
            { key: 'telemetry.sdk.language', value: { stringValue: 'nodejs' } },
          ],
        },
        scopeLogs: [{ scope: { name: 'x' }, logRecords: records }],
      },
    ],
  }
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    timeUnixNano: NANOS,
    severityNumber: 17,
    severityText: 'ERROR',
    body: { stringValue: 'payment failed' },
    ...overrides,
  }
}

describe('the severity mapping', () => {
  it('follows the four-wide bands the OTLP specification defines', () => {
    const bands: Array<[number, string]> = [
      [1, 'trace'],
      [4, 'trace'],
      [5, 'debug'],
      [8, 'debug'],
      [9, 'info'],
      [12, 'info'],
      [13, 'warn'],
      [16, 'warn'],
      [17, 'error'],
      [20, 'error'],
      [21, 'fatal'],
      [24, 'fatal'],
    ]

    for (const [number, level] of bands) {
      expect(levelFor(number, undefined)).toBe(level)
    }
  })

  it('falls back to the text when there is no number', () => {
    expect(levelFor(undefined, 'WARN')).toBe('warn')
    expect(levelFor(undefined, 'warning')).toBe('warn')
    expect(levelFor(undefined, 'Fatal')).toBe('fatal')
  })

  it('calls it info when it can tell nothing, rather than dropping the record', () => {
    for (const bad of [0, 25, -1, 'nonsense', null, undefined]) {
      expect(OTLP_SEVERITY_LEVELS).toContain(levelFor(bad, bad))
    }
    expect(levelFor(undefined, undefined)).toBe('info')
  })

  it('falls through to the text when the number is outside the bands', () => {
    for (const outside of [0, 25, -1, 99, 1.5e9]) {
      expect(levelFor(outside, 'ERROR')).toBe('error')
    }
    expect(levelFor(17, 'ERROR')).toBe('error')
  })

  it('prefers the number over the text, as the specification says', () => {
    expect(levelFor(17, 'DEBUG')).toBe('error')
  })
})

describe('the timestamp', () => {
  it('reads nanoseconds past a safe integer without losing the millisecond', () => {
    expect(millisFrom(NANOS)).toBe(AT)
    expect(Number(NANOS)).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })

  it('does not round a millisecond away, which reading it as a float does', () => {
    const nanos = '1762257600999999999'

    expect(millisFrom(nanos)).toBe(1_762_257_600_999)
    expect(Math.floor(Number(nanos) / 1e6)).toBe(1_762_257_601_000)
  })

  it('takes a number too, which some exporters send', () => {
    expect(millisFrom(1_700_000_000_000_000)).toBe(1_700_000_000)
  })

  it('refuses anything that is not a moment', () => {
    for (const bad of ['0', '', 'abc', -1, 0, null, undefined, '1e9']) {
      expect(millisFrom(bad)).toBeNull()
    }
  })
})

describe('reading an AnyValue', () => {
  it('reads each of the simple kinds', () => {
    expect(anyValue({ stringValue: 'a' })).toBe('a')
    expect(anyValue({ boolValue: false })).toBe(false)
    expect(anyValue({ doubleValue: 1.5 })).toBe(1.5)
    expect(anyValue({ intValue: 7 })).toBe(7)
  })

  it('keeps a big integer as text, because it does not fit in a number', () => {
    expect(anyValue({ intValue: '18446744073709551615' })).toBe('18446744073709551615')
  })

  it('flattens a list and a map into JSON rather than dropping them', () => {
    expect(anyValue({ arrayValue: { values: [{ stringValue: 'a' }, { intValue: 2 }] } })).toBe(
      '["a",2]',
    )
    expect(anyValue({ kvlistValue: { values: [{ key: 'a', value: { stringValue: 'b' } }] } })).toBe(
      '{"a":"b"}',
    )
  })

  it('stops before a deeply nested value can cost a Worker its budget', () => {
    let nested: Record<string, unknown> = { stringValue: 'bottom' }
    for (let at = 0; at < 20; at += 1) {
      nested = { arrayValue: { values: [nested] } }
    }

    const read = String(anyValue(nested))

    expect(read).not.toContain('bottom')
    expect(read.length).toBeLessThan(40)
  })

  it('reads a value nested no deeper than the limit allows, whole', () => {
    expect(
      anyValue({ arrayValue: { values: [{ arrayValue: { values: [{ stringValue: 'kept' }] } }] } }),
    ).toBe('["[\\"kept\\"]"]')
  })

  it('reads nothing from a value it does not know', () => {
    for (const bad of [null, 'a', 42, {}, { somethingElse: 1 }]) {
      expect(anyValue(bad)).toBeNull()
    }
  })
})

describe('attributes', () => {
  it('reads a key-value list into an object', () => {
    expect(
      attributesFrom([
        { key: 'orderId', value: { stringValue: 'ord_1' } },
        { key: 'retry', value: { boolValue: true } },
      ]),
    ).toEqual({ orderId: 'ord_1', retry: true })
  })

  it('drops a key the payload contract would refuse anyway', () => {
    expect(
      attributesFrom([
        { key: 'bad key!', value: { stringValue: 'x' } },
        { key: '', value: { stringValue: 'x' } },
        { key: 'a'.repeat(200), value: { stringValue: 'x' } },
        { key: 'good', value: { stringValue: 'x' } },
      ]),
    ).toEqual({ good: 'x' })
  })

  it('reads nothing from anything that is not a list', () => {
    for (const bad of [undefined, null, 'a', {}, 42]) {
      expect(attributesFrom(bad)).toEqual({})
    }
  })
})

describe('the body', () => {
  it('takes the string a log record carries', () => {
    expect(bodyText({ stringValue: 'hello' })).toBe('hello')
  })

  it('turns a number or a boolean into text rather than dropping the record', () => {
    expect(bodyText({ intValue: 42 })).toBe('42')
    expect(bodyText({ boolValue: true })).toBe('true')
  })

  it('cuts a body at the size the payload contract allows', () => {
    expect(bodyText({ stringValue: 'x'.repeat(MAX_OTLP_BODY_CHARS * 2) })).toHaveLength(
      MAX_OTLP_BODY_CHARS,
    )
  })

  it('is empty when there is nothing readable', () => {
    expect(bodyText(undefined)).toBe('')
    expect(bodyText({})).toBe('')
  })
})

describe('translating a request', () => {
  it('turns a record into an event our own parser accepts', () => {
    const { resource, events } = translateOtlp(payload([record()]), AT)

    const parsed = parseBatch({
      schemaVersion: 1,
      batchId: uuidv7(),
      sdk: { name: 'otlp', version: '1' },
      resource,
      events,
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.batch.accepted).toHaveLength(1)
    expect(parsed.ok && parsed.batch.accepted[0]?.event.level).toBe('error')
    expect(parsed.ok && parsed.batch.accepted[0]?.event.message).toBe('payment failed')
  })

  it('reads the service, the version and the runtime off the resource', () => {
    expect(translateOtlp(payload([record()]), AT).resource).toEqual({
      service: 'checkout-api',
      release: '1.4.2',
      runtime: 'node',
    })
  })

  it('maps the languages it knows and falls back for the rest', () => {
    const languages: Array<[string, string]> = [
      ['nodejs', 'node'],
      ['webjs', 'browser'],
      ['deno', 'deno'],
      ['bun', 'bun'],
      ['erlang', DEFAULT_RUNTIME],
    ]

    for (const [language, runtime] of languages) {
      const translated = translateOtlp(
        payload([record()], {
          attributes: [{ key: 'telemetry.sdk.language', value: { stringValue: language } }],
        }),
        AT,
      )
      expect(translated.resource.runtime).toBe(runtime)
    }
  })

  it('names the service "default" when the resource does not', () => {
    expect(translateOtlp(payload([record()], { attributes: [] }), AT).resource.service).toBe(
      DEFAULT_SERVICE,
    )
  })

  it('merges resource attributes into each event, without repeating the service', () => {
    const { events } = translateOtlp(
      payload([record({ attributes: [{ key: 'orderId', value: { stringValue: 'ord_1' } }] })]),
      AT,
    )
    const attributes = events[0]?.attributes as Record<string, unknown>

    expect(attributes.orderId).toBe('ord_1')
    expect(attributes['telemetry.sdk.language']).toBe('nodejs')
    expect(attributes['service.name']).toBeUndefined()
    expect(attributes['service.version']).toBeUndefined()
  })

  it('lets a record attribute win over a resource one of the same name', () => {
    const { events } = translateOtlp(
      payload([
        record({ attributes: [{ key: 'telemetry.sdk.language', value: { stringValue: 'mine' } }] }),
      ]),
      AT,
    )

    const attributes = (events[0]?.attributes ?? {}) as Record<string, unknown>
    expect(attributes['telemetry.sdk.language']).toBe('mine')
  })

  it('carries a trace only when both halves are the right shape', () => {
    const good = translateOtlp(
      payload([record({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) })]),
      AT,
    )
    expect(good.events[0]?.trace).toEqual({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) })

    for (const bad of [
      { traceId: 'a'.repeat(32) },
      { spanId: 'b'.repeat(16) },
      { traceId: 'short', spanId: 'b'.repeat(16) },
      { traceId: 'a'.repeat(32), spanId: 'zzzz' },
    ]) {
      expect(translateOtlp(payload([record(bad)]), AT).events[0]?.trace).toBeUndefined()
    }
  })

  it('accepts an upper-case trace id, which some exporters send', () => {
    const { events } = translateOtlp(
      payload([record({ traceId: 'A'.repeat(32), spanId: 'B'.repeat(16) })]),
      AT,
    )

    const trace = (events[0]?.trace ?? {}) as { traceId?: string }
    expect(trace.traceId).toBe('a'.repeat(32))
  })

  it('falls back to the observed time, then to the moment it arrived', () => {
    const observed = AT - 90_000
    const observedNanos = String(BigInt(observed) * 1000000n)

    expect(
      translateOtlp(
        payload([record({ timeUnixNano: '0', observedTimeUnixNano: observedNanos })]),
        AT,
      ).events[0]?.timestamp,
    ).toBe(new Date(observed).toISOString())

    expect(
      translateOtlp(payload([record({ timeUnixNano: undefined })]), AT).events[0]?.timestamp,
    ).toBe(new Date(AT).toISOString())
  })

  it('drops a record with no readable body, and counts it', () => {
    const translated = translateOtlp(payload([record({ body: {} }), record()]), AT)

    expect(translated.events).toHaveLength(1)
    expect(translated.dropped).toBe(1)
  })

  it('stops at the batch limit rather than building something the parser refuses', () => {
    const many = Array.from({ length: MAX_OTLP_RECORDS + 10 }, () => record())
    const translated = translateOtlp(payload(many), AT)

    expect(translated.events).toHaveLength(MAX_OTLP_RECORDS)
    expect(translated.dropped).toBe(10)
  })

  it('walks every resource and every scope, not only the first', () => {
    const translated = translateOtlp(
      {
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              { logRecords: [record({ body: { stringValue: 'a' } })] },
              { logRecords: [record({ body: { stringValue: 'b' } })] },
            ],
          },
          {
            resource: { attributes: [] },
            scopeLogs: [{ logRecords: [record({ body: { stringValue: 'c' } })] }],
          },
        ],
      },
      AT,
    )

    expect(translated.events.map((one) => one.message)).toEqual(['a', 'b', 'c'])
  })

  it('refuses a body that is not an OTLP request at all', () => {
    for (const bad of [null, [], 'otlp', 42, {}, { resourceLogs: 'x' }]) {
      expect(() => translateOtlp(bad, AT)).toThrow(OtlpError)
    }
  })

  it('reads an empty request as nothing to do, not as an error', () => {
    const translated = translateOtlp({ resourceLogs: [] }, AT)

    expect(translated.events).toEqual([])
    expect(translated.dropped).toBe(0)
  })

  it('skips a malformed group instead of refusing the whole request', () => {
    const translated = translateOtlp(
      {
        resourceLogs: [
          null,
          { scopeLogs: 'nope' },
          { resource: { attributes: [] }, scopeLogs: [{ logRecords: [record()] }] },
        ],
      },
      AT,
    )

    expect(translated.events).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'
import {
  isoTimestamp,
  mergeContexts,
  normaliseFingerprint,
  normaliseMessage,
  normaliseSession,
  normaliseTrace,
} from './event.ts'
import {
  EMPTY_MESSAGE_PLACEHOLDER,
  MAX_FINGERPRINT_ITEMS,
  MAX_MESSAGE_BYTES,
  MAX_SESSION_ID_CHARS,
  MAX_USER_ID_CHARS,
} from './limits.ts'

const GOOD_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const GOOD_SPAN_ID = '00f067aa0ba902b7'

describe('normaliseTrace', () => {
  it('keeps a W3C-shaped pair', () => {
    expect(normaliseTrace({ traceId: GOOD_TRACE_ID, spanId: GOOD_SPAN_ID })).toEqual({
      traceId: GOOD_TRACE_ID,
      spanId: GOOD_SPAN_ID,
    })
  })

  it('drops the pair when only the trace id is the wrong length', () => {
    expect(normaliseTrace({ traceId: '4bf92f35', spanId: GOOD_SPAN_ID })).toBeUndefined()
  })

  it('drops the pair when only the trace id is not hex', () => {
    expect(
      normaliseTrace({ traceId: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', spanId: GOOD_SPAN_ID }),
    ).toBeUndefined()
  })

  it('drops the pair when only the span id is the wrong length', () => {
    expect(normaliseTrace({ traceId: GOOD_TRACE_ID, spanId: '00f067aa' })).toBeUndefined()
  })

  it('drops the pair when only the span id is not hex', () => {
    expect(normaliseTrace({ traceId: GOOD_TRACE_ID, spanId: 'zzzzzzzzzzzzzzzz' })).toBeUndefined()
  })

  it('drops a pair whose ids are not strings at all', () => {
    expect(normaliseTrace({ traceId: 1 as never, spanId: GOOD_SPAN_ID })).toBeUndefined()
  })

  it('returns undefined when there is no trace', () => {
    expect(normaliseTrace(undefined)).toBeUndefined()
  })
})

describe('normaliseSession', () => {
  it('keeps the parts that are present', () => {
    expect(normaliseSession({ id: 's_1' })).toEqual({ id: 's_1' })
    expect(normaliseSession({ userId: 'u_1' })).toEqual({ userId: 'u_1' })
  })

  it('cuts an id past the contract limit', () => {
    expect(normaliseSession({ id: 'x'.repeat(200) })?.id).toHaveLength(MAX_SESSION_ID_CHARS)
  })

  it('cuts a user id past the contract limit', () => {
    expect(normaliseSession({ userId: 'x'.repeat(300) })?.userId).toHaveLength(MAX_USER_ID_CHARS)
  })

  it('returns undefined rather than an empty object', () => {
    expect(normaliseSession({})).toBeUndefined()
    expect(normaliseSession({ id: '' })).toBeUndefined()
  })
})

describe('normaliseFingerprint', () => {
  it('keeps the parts in order', () => {
    expect(normaliseFingerprint(['payment', 'timeout'])).toEqual(['payment', 'timeout'])
  })

  it('cuts the list at the contract limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`)
    expect(normaliseFingerprint(many)).toHaveLength(MAX_FINGERPRINT_ITEMS)
  })

  it('drops entries that are empty or not strings', () => {
    expect(normaliseFingerprint(['a', '', 1 as never, null as never])).toEqual(['a'])
  })

  it('returns undefined for nothing usable', () => {
    expect(normaliseFingerprint([])).toBeUndefined()
    expect(normaliseFingerprint(undefined)).toBeUndefined()
    expect(normaliseFingerprint('nope' as never)).toBeUndefined()
  })
})

describe('normaliseMessage', () => {
  it('leaves an ordinary message alone', () => {
    expect(normaliseMessage('Pedido criado')).toBe('Pedido criado')
  })

  it('cuts at the byte limit, not the character count', () => {
    expect(normaliseMessage('é'.repeat(MAX_MESSAGE_BYTES))).toHaveLength(MAX_MESSAGE_BYTES / 2)
  })

  it('never returns an empty string, which the api rejects', () => {
    expect(normaliseMessage('')).toBe(EMPTY_MESSAGE_PLACEHOLDER)
  })
})

describe('isoTimestamp', () => {
  it('formats with milliseconds, in UTC', () => {
    expect(isoTimestamp(Date.UTC(2026, 9, 30, 14, 3, 12, 481))).toBe('2026-10-30T14:03:12.481Z')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 * 2])(
    'still returns a valid timestamp for %p',
    (value) => {
      expect(isoTimestamp(value)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    },
  )
})

describe('mergeContexts', () => {
  it('returns an empty context when neither side has anything', () => {
    expect(mergeContexts({}, {})).toEqual({})
  })

  it('lets the child win on a shared attribute key', () => {
    expect(
      mergeContexts({ attributes: { a: 1, b: 1 } }, { attributes: { b: 2 } }).attributes,
    ).toEqual({ a: 1, b: 2 })
  })

  it('replaces the trace rather than merging its halves', () => {
    const parent = { traceId: GOOD_TRACE_ID, spanId: GOOD_SPAN_ID }
    const child = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }

    expect(mergeContexts({ trace: parent }, { trace: child }).trace).toEqual(child)
  })

  it('keeps the parent trace when the child sets none', () => {
    const parent = { traceId: GOOD_TRACE_ID, spanId: GOOD_SPAN_ID }

    expect(mergeContexts({ trace: parent }, {}).trace).toEqual(parent)
  })

  it('merges the two halves of a session', () => {
    expect(
      mergeContexts({ session: { id: 's_1' } }, { session: { userId: 'u_1' } }).session,
    ).toEqual({ id: 's_1', userId: 'u_1' })
  })

  it('replaces the fingerprint, since it is a grouping decision', () => {
    expect(mergeContexts({ fingerprint: ['a'] }, { fingerprint: ['b'] }).fingerprint).toEqual(['b'])
  })

  it('does not mutate either side', () => {
    const parent = { attributes: { a: 1 } }
    const child = { attributes: { b: 2 } }

    mergeContexts(parent, child)

    expect(parent).toEqual({ attributes: { a: 1 } })
    expect(child).toEqual({ attributes: { b: 2 } })
  })
})

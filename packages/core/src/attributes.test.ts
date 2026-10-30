import { describe, expect, it } from 'vitest'
import { flattenAttributes, sanitiseKey } from './attributes.ts'
import { MAX_ATTRIBUTE_KEY_CHARS, MAX_ATTRIBUTE_KEYS, MAX_ATTRIBUTE_VALUE_BYTES } from './limits.ts'

describe('sanitiseKey', () => {
  it('keeps a key that already fits the contract', () => {
    expect(sanitiseKey('user.id-2_x')).toBe('user.id-2_x')
  })

  it('replaces characters the contract does not allow', () => {
    expect(sanitiseKey('user name!')).toBe('user_name_')
  })

  it('cuts a key longer than the limit', () => {
    expect(sanitiseKey('a'.repeat(200))).toHaveLength(MAX_ATTRIBUTE_KEY_CHARS)
  })

  it('rejects a key that sanitises to nothing', () => {
    expect(sanitiseKey('')).toBeNull()
  })
})

describe('flattenAttributes', () => {
  it('returns undefined for nothing to record', () => {
    expect(flattenAttributes(undefined)).toBeUndefined()
    expect(flattenAttributes({})).toBeUndefined()
  })

  it('flattens nested objects with dots', () => {
    expect(flattenAttributes({ user: { id: 1, address: { city: 'Recife' } } })).toEqual({
      'user.id': 1,
      'user.address.city': 'Recife',
    })
  })

  it('flattens arrays by index', () => {
    expect(flattenAttributes({ tags: ['a', 'b'] })).toEqual({ 'tags.0': 'a', 'tags.1': 'b' })
  })

  it('drops undefined, functions and symbols', () => {
    expect(flattenAttributes({ a: undefined, b: () => 1, c: Symbol('s'), d: 1 })).toEqual({ d: 1 })
  })

  it('keeps null, which the contract allows', () => {
    expect(flattenAttributes({ a: null })).toEqual({ a: null })
  })

  it('turns a Date into an ISO string', () => {
    expect(flattenAttributes({ at: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)) })).toEqual({
      at: '2026-01-02T03:04:05.006Z',
    })
  })

  it('names an invalid Date rather than emitting one', () => {
    expect(flattenAttributes({ at: new Date('nope') })).toEqual({ at: 'Invalid Date' })
  })

  it('turns a bigint into a string, since JSON cannot carry one', () => {
    expect(flattenAttributes({ big: 9007199254740993n })).toEqual({ big: '9007199254740993' })
  })

  it('turns a non-finite number into a string, since the contract wants finite numbers', () => {
    expect(flattenAttributes({ a: Number.NaN, b: Number.POSITIVE_INFINITY })).toEqual({
      a: 'NaN',
      b: 'Infinity',
    })
  })

  it('reduces an Error to its name and message, never its stack', () => {
    expect(flattenAttributes({ cause: new TypeError('bad input') })).toEqual({
      'cause.name': 'TypeError',
      'cause.message': 'bad input',
    })
  })

  it('flattens a class instance that has no custom toString', () => {
    class Point {
      x = 1
      y = 2
    }
    expect(flattenAttributes({ p: new Point() })).toEqual({ 'p.x': 1, 'p.y': 2 })
  })

  it('uses toString for an object that defines one', () => {
    class Money {
      toString() {
        return 'BRL 9.90'
      }
    }
    expect(flattenAttributes({ total: new Money() })).toEqual({ total: 'BRL 9.90' })
  })

  it('marks a cycle instead of looping forever', () => {
    const node: Record<string, unknown> = { id: 1 }
    node.self = node

    expect(flattenAttributes({ node })).toEqual({ 'node.id': 1, 'node.self': '[Circular]' })
  })

  it('lets the same object appear twice when it is not a cycle', () => {
    const shared = { id: 1 }

    expect(flattenAttributes({ a: shared, b: shared })).toEqual({ 'a.id': 1, 'b.id': 1 })
  })

  it('stops flattening past the depth limit', () => {
    let deep: Record<string, unknown> = { value: 'bottom' }
    for (let i = 0; i < 20; i++) {
      deep = { nested: deep }
    }

    const flat = flattenAttributes(deep) ?? {}
    expect(Object.keys(flat)).toHaveLength(1)
    expect(Object.keys(flat)[0]?.split('.').length).toBeLessThanOrEqual(9)
  })

  it('cuts a string value at the byte limit', () => {
    const flat = flattenAttributes({ big: 'x'.repeat(MAX_ATTRIBUTE_VALUE_BYTES + 100) }) ?? {}

    expect(flat.big).toHaveLength(MAX_ATTRIBUTE_VALUE_BYTES)
  })

  it('stops at the key limit instead of sending more than the contract allows', () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < MAX_ATTRIBUTE_KEYS + 50; i++) {
      wide[`k${i}`] = i
    }

    expect(Object.keys(flattenAttributes(wide) ?? {})).toHaveLength(MAX_ATTRIBUTE_KEYS)
  })

  it('sanitises keys produced by flattening', () => {
    expect(flattenAttributes({ 'user name': { 'first!': 'Alex' } })).toEqual({
      'user_name.first_': 'Alex',
    })
  })
})

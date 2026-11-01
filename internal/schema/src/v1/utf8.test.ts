import { describe, expect, it } from 'vitest'
import { truncateToUtf8Bytes, utf8ByteLength } from './utf8.ts'

describe('utf8ByteLength', () => {
  it('counts ASCII as one byte each', () => {
    expect(utf8ByteLength('abc')).toBe(3)
  })

  it('counts accented Latin as two bytes', () => {
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('ção')).toBe(5)
  })

  it('counts CJK as three bytes', () => {
    expect(utf8ByteLength('日')).toBe(3)
  })

  it('counts an emoji surrogate pair as four bytes, not six', () => {
    expect(utf8ByteLength('🐱')).toBe(4)
  })

  it('matches TextEncoder for a mixed string', () => {
    const sample = 'a é 日 🐱 fim'
    expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).length)
  })

  it('handles an empty string', () => {
    expect(utf8ByteLength('')).toBe(0)
  })
})

describe('truncateToUtf8Bytes', () => {
  it('leaves a string under the limit untouched', () => {
    expect(truncateToUtf8Bytes('hello', 10)).toEqual({ value: 'hello', truncated: false })
  })

  it('leaves a string exactly at the limit untouched', () => {
    expect(truncateToUtf8Bytes('hello', 5)).toEqual({ value: 'hello', truncated: false })
  })

  it('truncates ASCII at the byte boundary', () => {
    expect(truncateToUtf8Bytes('hello', 3)).toEqual({ value: 'hel', truncated: true })
  })

  it('never splits a multi-byte character', () => {
    const result = truncateToUtf8Bytes('éé', 3)
    expect(result).toEqual({ value: 'é', truncated: true })
    expect(utf8ByteLength(result.value)).toBeLessThanOrEqual(3)
  })

  it('never splits an emoji surrogate pair', () => {
    const result = truncateToUtf8Bytes('🐱🐱', 6)
    expect(result).toEqual({ value: '🐱', truncated: true })
    expect(utf8ByteLength(result.value)).toBeLessThanOrEqual(6)
  })

  it('produces a string that still decodes cleanly', () => {
    const result = truncateToUtf8Bytes('日本語', 4)
    expect(result.value).toBe('日')
    expect(new TextEncoder().encode(result.value).length).toBeLessThanOrEqual(4)
  })

  it('returns empty when the limit cannot fit a single character', () => {
    expect(truncateToUtf8Bytes('🐱', 2)).toEqual({ value: '', truncated: true })
  })

  it('always stays within the limit and round-trips, at every limit', () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const sample = 'aé日🐱zß中𝄞x'

    for (let limit = 0; limit <= encoder.encode(sample).length + 2; limit++) {
      const { value, truncated } = truncateToUtf8Bytes(sample, limit)
      const encoded = encoder.encode(value)

      expect(encoded.length, `limit ${limit}`).toBeLessThanOrEqual(limit)
      expect(() => decoder.decode(encoded), `limit ${limit}`).not.toThrow()
      expect(sample.startsWith(value), `limit ${limit}`).toBe(true)
      expect(truncated, `limit ${limit}`).toBe(value !== sample)
    }
  })
})

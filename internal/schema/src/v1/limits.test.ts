import { describe, expect, it } from 'vitest'
import * as limits from './limits.ts'

describe('the numbers specification 1 promises', () => {
  it.each([
    ['SCHEMA_VERSION', limits.SCHEMA_VERSION, 1],
    ['MIN_EVENTS_PER_BATCH', limits.MIN_EVENTS_PER_BATCH, 1],
    ['MAX_EVENTS_PER_BATCH', limits.MAX_EVENTS_PER_BATCH, 500],
    ['MAX_BATCH_BYTES', limits.MAX_BATCH_BYTES, 512 * 1024],
    ['MAX_MESSAGE_BYTES', limits.MAX_MESSAGE_BYTES, 16 * 1024],
    ['MAX_ATTRIBUTE_KEYS', limits.MAX_ATTRIBUTE_KEYS, 100],
    ['MAX_ATTRIBUTE_KEY_CHARS', limits.MAX_ATTRIBUTE_KEY_CHARS, 128],
    ['MAX_ATTRIBUTE_VALUE_BYTES', limits.MAX_ATTRIBUTE_VALUE_BYTES, 4 * 1024],
    ['TRACE_ID_CHARS', limits.TRACE_ID_CHARS, 32],
    ['SPAN_ID_CHARS', limits.SPAN_ID_CHARS, 16],
    ['MAX_SESSION_ID_CHARS', limits.MAX_SESSION_ID_CHARS, 64],
    ['MAX_USER_ID_CHARS', limits.MAX_USER_ID_CHARS, 128],
    ['MAX_ERROR_TYPE_CHARS', limits.MAX_ERROR_TYPE_CHARS, 256],
    ['MAX_ERROR_MESSAGE_BYTES', limits.MAX_ERROR_MESSAGE_BYTES, 4 * 1024],
    ['MAX_ERROR_STACK_BYTES', limits.MAX_ERROR_STACK_BYTES, 32 * 1024],
    ['MAX_FINGERPRINT_ITEMS', limits.MAX_FINGERPRINT_ITEMS, 5],
    ['MAX_SDK_NAME_CHARS', limits.MAX_SDK_NAME_CHARS, 64],
    ['MAX_SDK_VERSION_CHARS', limits.MAX_SDK_VERSION_CHARS, 64],
    ['MAX_SERVICE_CHARS', limits.MAX_SERVICE_CHARS, 128],
    ['MAX_RELEASE_CHARS', limits.MAX_RELEASE_CHARS, 64],
  ])('%s is %d, as docs/ESPECIFICACOES.md section 1 says', (_name, actual, documented) => {
    expect(actual).toBe(documented)
  })

  it('accepts exactly the six levels the specification lists', () => {
    expect(limits.LOG_LEVELS).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
  })

  it('accepts exactly the five runtimes the specification lists', () => {
    expect(limits.RUNTIMES).toEqual(['browser', 'node', 'edge', 'bun', 'deno'])
  })

  it('supports only the schema versions the specification lists', () => {
    expect(limits.SUPPORTED_SCHEMA_VERSIONS).toEqual([1])
  })

  it('names the service "default" when the sender does not', () => {
    expect(limits.DEFAULT_SERVICE).toBe('default')
  })

  it('allows only the attribute key characters the specification lists', () => {
    for (const key of ['orderId', 'tag.name', 'a-b', 'A_1']) {
      expect(limits.ATTRIBUTE_KEY_PATTERN.test(key)).toBe(true)
    }
    for (const key of ['a b', 'chave-com-ç', 'a:b', 'a/b', '']) {
      expect(limits.ATTRIBUTE_KEY_PATTERN.test(key)).toBe(false)
    }
  })
})

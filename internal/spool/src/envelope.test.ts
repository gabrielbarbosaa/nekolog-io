import { describe, expect, it } from 'vitest'
import {
  decodeSpoolEnvelope,
  deduplicationTokenFor,
  encodeSpoolEnvelope,
  type NewSpoolEnvelope,
  SPOOL_VERSION,
} from './envelope.ts'
import { SpoolFormatError } from './errors.ts'

const BATCH_ID = '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10'

function envelope(overrides: Partial<NewSpoolEnvelope> = {}): NewSpoolEnvelope {
  return {
    spooledAt: Date.UTC(2026, 9, 31, 12, 0, 0),
    batchId: BATCH_ID,
    projectId: 'p_1',
    environmentId: 'e_1',
    deduplicationToken: `e_1:${BATCH_ID}`,
    rows: [{ project_id: 'p_1', message: 'hello' }],
    ...overrides,
  }
}

function encodedWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({ spoolVersion: SPOOL_VERSION, ...envelope(), ...overrides })
}

describe('encode and decode', () => {
  it('survives the round trip, bytes or text', () => {
    const written = encodeSpoolEnvelope(envelope())
    const expected = { ...envelope(), spoolVersion: SPOOL_VERSION }

    expect(decodeSpoolEnvelope(written)).toEqual(expected)
    expect(decodeSpoolEnvelope(new TextEncoder().encode(written))).toEqual(expected)
  })

  it('stamps the format version, so a later format can tell itself apart', () => {
    expect(JSON.parse(encodeSpoolEnvelope(envelope())).spoolVersion).toBe(SPOOL_VERSION)
  })

  it('refuses to write a batch id that would not be safe as a key', () => {
    expect(() => encodeSpoolEnvelope(envelope({ batchId: '../x' }))).toThrow(/plain UUID/)
  })
})

describe('decodeSpoolEnvelope', () => {
  it('refuses a file from a format it does not know', () => {
    expect(() => decodeSpoolEnvelope(encodedWith({ spoolVersion: 2 }))).toThrow(SpoolFormatError)
  })

  it.each([
    ['not json at all', 'not json at all'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
  ])('refuses %s', (_name, raw) => {
    expect(() => decodeSpoolEnvelope(raw)).toThrow(SpoolFormatError)
  })

  it.each([
    ['no rows', { rows: [] }],
    ['rows that are not objects', { rows: ['hello'] }],
    ['a row that is an array', { rows: [[]] }],
    ['no batch id', { batchId: '' }],
    ['an unsafe batch id', { batchId: '../escape' }],
    ['no project', { projectId: '' }],
    ['no environment', { environmentId: '' }],
    ['no deduplication token', { deduplicationToken: '' }],
    ['a fractional spooledAt', { spooledAt: 1.5 }],
    ['a negative spooledAt', { spooledAt: -1 }],
    ['a spooledAt that is text', { spooledAt: '2026-10-31' }],
  ])('refuses a file with %s', (_name, overrides) => {
    expect(() => decodeSpoolEnvelope(encodedWith(overrides))).toThrow(SpoolFormatError)
  })

  it('refuses bytes that are not valid UTF-8', () => {
    expect(() => decodeSpoolEnvelope(new Uint8Array([0x7b, 0xff, 0xfe]))).toThrow()
  })

  it('keeps every row exactly as it was written', () => {
    const rows = [
      { message: 'line one\nline two', attributes: { 'a.b': 'c' }, fingerprint: 0 },
      { message: '', nested: { deep: [1, 2, 3] } },
    ]

    expect(decodeSpoolEnvelope(encodeSpoolEnvelope(envelope({ rows }))).rows).toEqual(rows)
  })
})

describe('deduplicationTokenFor', () => {
  it('scopes the batch id to its environment', () => {
    expect(deduplicationTokenFor('e_1', BATCH_ID)).toBe(`e_1:${BATCH_ID}`)
  })

  it('cannot collide across environments, even on the same batch id', () => {
    expect(deduplicationTokenFor('e_1', BATCH_ID)).not.toBe(deduplicationTokenFor('e_2', BATCH_ID))
  })

  it('refuses a batch id that is not a plain UUID', () => {
    expect(() => deduplicationTokenFor('e_1', 'anything')).toThrow(/plain UUID/)
  })
})

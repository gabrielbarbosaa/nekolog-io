import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { parseBatch } from './parse.ts'
import { batchIdSchema } from './schema.ts'
import { uuidv7 } from './uuid.ts'

const AT = Date.UTC(2026, 10, 4, 12, 0, 0)

function parse(id: string): boolean {
  return v.safeParse(batchIdSchema, id).success
}

describe('uuidv7', () => {
  it('produces an id the batch contract accepts, every time', () => {
    for (let at = 0; at < 500; at += 1) {
      expect(parse(uuidv7())).toBe(true)
    }
  })

  it('carries the version and the variant the contract looks for', () => {
    const id = uuidv7()

    expect(id[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })

  it('puts the whole millisecond at the front, so two ids sort by when they were made', () => {
    const stamp = (id: string) => id.split('-').join('').slice(0, 12)

    expect(stamp(uuidv7(() => AT)) < stamp(uuidv7(() => AT + 1))).toBe(true)
    expect(stamp(uuidv7(() => AT)) < stamp(uuidv7(() => AT + 86_400_000))).toBe(true)
    expect(stamp(uuidv7(() => AT))).toBe(stamp(uuidv7(() => AT)))
  })

  it('never repeats, which is what makes it a deduplication token', () => {
    const seen = new Set<string>()
    for (let at = 0; at < 2000; at += 1) {
      seen.add(uuidv7(() => AT))
    }

    expect(seen.size).toBe(2000)
  })

  it('survives a clock that went backwards rather than producing something invalid', () => {
    expect(parse(uuidv7(() => -1))).toBe(true)
    expect(parse(uuidv7(() => 0))).toBe(true)
    expect(parse(uuidv7(() => Number.NaN))).toBe(true)
  })

  it('mints a batch id the parser takes, which is the only reason it exists', () => {
    const result = parseBatch({
      schemaVersion: 1,
      batchId: uuidv7(),
      sdk: { name: 'otlp', version: '1' },
      resource: { service: 'a', runtime: 'node' },
      events: [{ timestamp: '2026-11-04T12:00:00.000Z', level: 'info', message: 'hello' }],
    })

    expect(result.ok).toBe(true)
  })
})

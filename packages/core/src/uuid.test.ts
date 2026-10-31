import { describe, expect, it, vi } from 'vitest'
import { uuidv7 } from './uuid.ts'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidv7', () => {
  it('has the version 7 shape the ingest contract requires', () => {
    expect(uuidv7()).toMatch(UUID_V7)
  })

  it('still has that shape without crypto, falling back to Math.random', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      expect(uuidv7()).toMatch(UUID_V7)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('still has that shape with an absurd clock', () => {
    expect(uuidv7(() => 0)).toMatch(UUID_V7)
    expect(uuidv7(() => -1)).toMatch(UUID_V7)
    expect(uuidv7(() => Number.NaN)).toMatch(UUID_V7)
    expect(uuidv7(() => 2 ** 53)).toMatch(UUID_V7)
  })

  it('sorts by time, which is the point of version 7', () => {
    const earlier = uuidv7(() => Date.UTC(2026, 0, 1))
    const later = uuidv7(() => Date.UTC(2026, 6, 1))

    expect(earlier < later).toBe(true)
  })

  it('does not repeat itself at the same millisecond', () => {
    const fixed = () => Date.UTC(2026, 9, 30)
    const ids = new Set(Array.from({ length: 500 }, () => uuidv7(fixed)))

    expect(ids.size).toBe(500)
  })

  it('writes the timestamp into the first six bytes', () => {
    const at = Date.UTC(2026, 9, 30, 14, 3, 12, 481)
    const id = uuidv7(() => at)
    const prefix = id.replace(/-/g, '').slice(0, 12)

    expect(Number.parseInt(prefix, 16)).toBe(at)
  })
})

import { describe, expect, it } from 'vitest'
import {
  boundedTimestampMs,
  CLOCK_FLOOR_MARGIN_MS,
  CLOCK_SKEW_WARNING_MS,
  clockSkewMs,
  earliestStorableMs,
  isClockSkewed,
  latestStorableMs,
  MAX_CLOCK_AHEAD_MS,
} from './clock-skew.ts'

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0, 0)
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

describe('the limits this step is written against', () => {
  it('warns at the five minutes the plan writes down, not at a number derived from itself', () => {
    expect(CLOCK_SKEW_WARNING_MS).toBe(300_000)
    expect(MAX_CLOCK_AHEAD_MS).toBe(300_000)
    expect(CLOCK_FLOOR_MARGIN_MS).toBe(3_600_000)
  })
})

describe('clockSkewMs', () => {
  it('is positive when the client is behind the server', () => {
    expect(clockSkewMs(NOW - 90_000, NOW)).toBe(90_000)
  })

  it('is negative when the client runs ahead of the server', () => {
    expect(clockSkewMs(NOW + 90_000, NOW)).toBe(-90_000)
  })

  it('is zero for a clock in step', () => {
    expect(clockSkewMs(NOW, NOW)).toBe(0)
  })

  it('survives a date that did not parse rather than writing NaN into the row', () => {
    expect(clockSkewMs(Number.NaN, NOW)).toBe(0)
    expect(clockSkewMs(NOW, Number.NaN)).toBe(0)
  })

  it('stays exact for a clock decades out, where an Int32 of milliseconds would not', () => {
    const skew = clockSkewMs(Date.UTC(2099, 0, 1), NOW)

    expect(skew).toBe(NOW - Date.UTC(2099, 0, 1))
    expect(Math.abs(skew)).toBeGreaterThan(2_147_483_647)
    expect(Number.isSafeInteger(skew)).toBe(true)
  })
})

describe('isClockSkewed', () => {
  it('holds its tongue at exactly five minutes and speaks one millisecond later', () => {
    expect(isClockSkewed(CLOCK_SKEW_WARNING_MS)).toBe(false)
    expect(isClockSkewed(CLOCK_SKEW_WARNING_MS + 1)).toBe(true)
    expect(isClockSkewed(-CLOCK_SKEW_WARNING_MS - 1)).toBe(true)
  })
})

describe('earliestStorableMs', () => {
  it('leaves an hour of margin inside the retention, so a merge cannot eat the row', () => {
    expect(earliestStorableMs(NOW, 30)).toBe(NOW - (30 * DAY - CLOCK_FLOOR_MARGIN_MS))
  })

  it('follows a short retention down instead of assuming thirty days', () => {
    expect(earliestStorableMs(NOW, 1)).toBe(NOW - (DAY - CLOCK_FLOOR_MARGIN_MS))
  })

  it('never reaches past the moment of receipt, however small the retention', () => {
    expect(earliestStorableMs(NOW, 0)).toBe(NOW)
    expect(earliestStorableMs(NOW, -5)).toBe(NOW)
    expect(earliestStorableMs(NOW, Number.NaN)).toBe(NOW)
  })
})

describe('boundedTimestampMs', () => {
  it('leaves an ordinary timestamp exactly as the client sent it', () => {
    const sent = NOW - 4 * MINUTE
    expect(boundedTimestampMs(sent, NOW, 30)).toBe(sent)
  })

  it('leaves a replay from the offline queue alone, days late and still inside the retention', () => {
    const sent = NOW - 6 * DAY
    expect(boundedTimestampMs(sent, NOW, 30)).toBe(sent)
  })

  it('floors a timestamp the retention would have thrown away at the insert', () => {
    const sent = Date.UTC(2020, 0, 1)
    const stored = boundedTimestampMs(sent, NOW, 30)

    expect(stored).toBe(earliestStorableMs(NOW, 30))
    expect(stored).toBeGreaterThan(sent)
  })

  it('floors against the environment retention, not a fixed window', () => {
    const sent = NOW - 6 * DAY
    expect(boundedTimestampMs(sent, NOW, 1)).toBe(earliestStorableMs(NOW, 1))
    expect(boundedTimestampMs(sent, NOW, 30)).toBe(sent)
  })

  it('caps a clock set to 2099, which would otherwise never expire and never be found', () => {
    expect(boundedTimestampMs(Date.UTC(2099, 0, 1), NOW, 30)).toBe(latestStorableMs(NOW))
  })

  it('tolerates the few minutes of drift a real machine has, in both directions', () => {
    expect(boundedTimestampMs(NOW + MAX_CLOCK_AHEAD_MS, NOW, 30)).toBe(NOW + MAX_CLOCK_AHEAD_MS)
    expect(boundedTimestampMs(NOW + MAX_CLOCK_AHEAD_MS + 1, NOW, 30)).toBe(latestStorableMs(NOW))
  })

  it('falls back to the moment of receipt for a date that did not parse', () => {
    expect(boundedTimestampMs(Number.NaN, NOW, 30)).toBe(NOW)
  })

  it('keeps the original recoverable from the moment of receipt and the skew', () => {
    const sent = Date.UTC(2020, 0, 1)
    const skew = clockSkewMs(sent, NOW)

    expect(boundedTimestampMs(sent, NOW, 30)).not.toBe(sent)
    expect(NOW - skew).toBe(sent)
  })
})

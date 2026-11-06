import { HISTOGRAM_BUCKET_SECONDS } from '@nekolog-io/clickhouse/search'
import { describe, expect, it } from 'vitest'
import { LEVELS } from '../lib/explorer'
import { bucketFor, gridOf, MOST_BARS, secondsOf, volumeFrom } from '../lib/histogram'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function at(iso: string): number {
  return Date.parse(iso)
}

describe('choosing how wide a bar is', () => {
  it('never asks for more bars than anyone can read', () => {
    for (const span of [15 * MINUTE, HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY]) {
      const bucket = bucketFor(0, span)
      const bars = span / 1000 / secondsOf(bucket)

      expect(bars, `${bucket} over ${span / HOUR}h is ${bars} bars`).toBeLessThanOrEqual(MOST_BARS)
    }
  })

  it('takes the finest bucket that fits, not the coarsest that works', () => {
    expect(bucketFor(0, 15 * MINUTE)).toBe('1m')
    expect(bucketFor(0, HOUR)).toBe('1m')
    expect(bucketFor(0, 6 * HOUR)).toBe('5m')
    expect(bucketFor(0, DAY)).toBe('15m')
    expect(bucketFor(0, 7 * DAY)).toBe('1h')
    expect(bucketFor(0, 30 * DAY)).toBe('6h')
  })

  it('keeps every period well away from the edge, so a second cannot flip the bucket', () => {
    for (const span of [15 * MINUTE, HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY]) {
      const bars = span / 1000 / secondsOf(bucketFor(0, span))

      expect(
        Math.abs(bars - MOST_BARS),
        `a ${span / HOUR}h period is ${bars} bars, and the limit is ${MOST_BARS}`,
      ).toBeGreaterThan(5)
    }
  })

  it('only ever names a bucket ClickHouse knows', () => {
    for (const span of [MINUTE, HOUR, 365 * DAY]) {
      expect(Object.keys(HISTOGRAM_BUCKET_SECONDS)).toContain(bucketFor(0, span))
    }
  })

  it('says so rather than inventing a width', () => {
    expect(() => secondsOf('3y')).toThrow(/no bucket called/)
  })
})

describe('the grid the bars sit on', () => {
  it('aligns to the epoch, the way toStartOfInterval does', () => {
    const grid = gridOf(at('2026-11-06T19:04:12.345Z'), at('2026-11-06T19:20:00.000Z'), 300)

    expect(new Date(grid[0] as number).toISOString()).toBe('2026-11-06T19:00:00.000Z')
    expect(new Date(grid[1] as number).toISOString()).toBe('2026-11-06T19:05:00.000Z')
  })

  it('stops before the end, because the period is half open', () => {
    const grid = gridOf(at('2026-11-06T19:00:00Z'), at('2026-11-06T19:15:00Z'), 300)

    expect(grid).toHaveLength(3)
    expect(new Date(grid[2] as number).toISOString()).toBe('2026-11-06T19:10:00.000Z')
  })

  it('builds nothing from a period that runs backwards', () => {
    expect(gridOf(at('2026-11-06T19:00:00Z'), at('2026-11-06T18:00:00Z'), 60)).toEqual([])
    expect(gridOf(0, 1000, 0)).toEqual([])
  })
})

describe('turning counted rows into bands', () => {
  const grid = gridOf(at('2026-11-06T19:00:00Z'), at('2026-11-06T19:15:00Z'), 300)

  it('puts each count in the slice it belongs to', () => {
    const volume = volumeFrom(
      [
        { bucket: '2026-11-06 19:00:00', level: 'error', events: '2' },
        { bucket: '2026-11-06 19:10:00', level: 'error', events: '5' },
      ],
      grid,
    )

    expect(volume.bands).toHaveLength(1)
    expect(volume.bands[0]?.counts).toEqual([2, 0, 5])
    expect(volume.total).toBe(7)
  })

  it('reads a count ClickHouse quoted, because count() is a UInt64', () => {
    const volume = volumeFrom([{ bucket: '2026-11-06 19:00:00', level: 'info', events: '9' }], grid)

    expect(volume.bands[0]?.counts[0], 'a quoted count must not become NaN').toBe(9)
  })

  it('leaves a level nobody sent out of the legend', () => {
    const volume = volumeFrom([{ bucket: '2026-11-06 19:00:00', level: 'warn', events: '1' }], grid)

    expect(volume.bands.map((band) => band.level)).toEqual(['warn'])
  })

  it('keeps the bands in the order the levels climb', () => {
    const volume = volumeFrom(
      LEVELS.map((level) => ({ bucket: '2026-11-06 19:00:00', level, events: '1' })),
      grid,
    )

    expect(volume.bands.map((band) => band.level)).toEqual([...LEVELS])
  })

  it('drops a row for a slice outside the period rather than bending the grid', () => {
    const volume = volumeFrom(
      [{ bucket: '2020-01-01 00:00:00', level: 'error', events: '1000' }],
      grid,
    )

    expect(volume.total).toBe(0)
  })

  it('ignores a level this build does not know instead of drawing it as info', () => {
    const volume = volumeFrom(
      [{ bucket: '2026-11-06 19:00:00', level: 'shouting', events: '3' }],
      grid,
    )

    expect(volume.total).toBe(0)
  })

  it('counts nothing as nothing, and still gives the chart its slices', () => {
    const volume = volumeFrom([], grid)

    expect(volume.total).toBe(0)
    expect(volume.bands).toEqual([])
    expect(volume.buckets).toHaveLength(3)
  })
})

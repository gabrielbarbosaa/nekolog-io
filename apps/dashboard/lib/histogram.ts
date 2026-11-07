import { HISTOGRAM_BUCKET_SECONDS, HISTOGRAM_BUCKETS } from '@nekolog-io/clickhouse/search'
import { instantOf, isLevel, LEVELS, type Level } from './explorer'

export const MOST_BARS = 180

export type HistogramRow = Record<string, unknown>

export type Band = { level: Level; counts: number[]; total: number }

export type Volume = { buckets: number[]; bands: Band[]; total: number }

export function bucketFor(fromMs: number, toMs: number): string {
  const span = Math.max(0, toMs - fromMs) / 1000

  for (const name of HISTOGRAM_BUCKETS) {
    const seconds = HISTOGRAM_BUCKET_SECONDS[name] as number
    if (span / seconds <= MOST_BARS) {
      return name
    }
  }
  return HISTOGRAM_BUCKETS[HISTOGRAM_BUCKETS.length - 1] as string
}

export function secondsOf(bucket: string): number {
  const seconds = HISTOGRAM_BUCKET_SECONDS[bucket]
  if (seconds === undefined) {
    throw new Error(`There is no bucket called ${JSON.stringify(bucket)}.`)
  }
  return seconds
}

export function gridOf(fromMs: number, toMs: number, seconds: number): number[] {
  const step = seconds * 1000
  if (step <= 0 || toMs <= fromMs) {
    return []
  }

  const first = Math.floor(fromMs / step) * step
  const grid: number[] = []
  for (let at = first; at < toMs && grid.length <= MOST_BARS + 2; at += step) {
    grid.push(at)
  }
  return grid
}

function countOf(value: unknown): number {
  const found = typeof value === 'string' ? Number(value) : value
  return typeof found === 'number' && Number.isFinite(found) ? found : 0
}

export function volumeFrom(rows: readonly HistogramRow[], grid: readonly number[]): Volume {
  const at = new Map(grid.map((moment, index) => [moment, index]))
  const counts = new Map<Level, number[]>(
    LEVELS.map((level) => [level, new Array<number>(grid.length).fill(0)]),
  )

  for (const row of rows) {
    const level = typeof row.level === 'string' ? row.level : ''
    if (!isLevel(level)) {
      continue
    }
    const index = at.get(instantOf(typeof row.bucket === 'string' ? row.bucket : ''))
    if (index === undefined) {
      continue
    }
    const into = counts.get(level) as number[]
    into[index] = (into[index] as number) + countOf(row.events)
  }

  const bands = LEVELS.map((level): Band => {
    const held = counts.get(level) as number[]
    return { level, counts: held, total: held.reduce((sum, one) => sum + one, 0) }
  }).filter((band) => band.total > 0)

  return { buckets: [...grid], bands, total: bands.reduce((sum, band) => sum + band.total, 0) }
}

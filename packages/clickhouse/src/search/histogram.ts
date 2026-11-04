import { assertIdentifier } from '../log-store.ts'
import type { CompiledSearch, CompileOptions } from './compile.ts'
import type { SearchNode } from './parse.ts'
import { SCOPE_PREFIX, type SearchScope, searchWhere } from './scope.ts'

export const HISTOGRAM_BUCKET_SECONDS: Readonly<Record<string, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '1d': 86400,
}

export const HISTOGRAM_BUCKETS: readonly string[] = Object.keys(HISTOGRAM_BUCKET_SECONDS)

export const DEFAULT_HISTOGRAM_BUCKET = '5m'
export const MAX_HISTOGRAM_BUCKETS = 1500

export const BUCKET_COLUMN = 'bucket'
export const EVENTS_COLUMN = 'events'

export type HistogramTarget = {
  database: string
  table?: string
}

export type HistogramOptions = CompileOptions & {
  bucket?: string
}

export function bucketSecondsFor(name: string | undefined): number {
  const chosen = name ?? DEFAULT_HISTOGRAM_BUCKET
  const seconds = Object.hasOwn(HISTOGRAM_BUCKET_SECONDS, chosen)
    ? HISTOGRAM_BUCKET_SECONDS[chosen]
    : undefined
  if (seconds === undefined) {
    throw new Error(
      `There is no bucket called ${JSON.stringify(chosen)}. The buckets are ${HISTOGRAM_BUCKETS.join(', ')}.`,
    )
  }
  return seconds
}

export function chooseBucket(scope: SearchScope, requested: string | undefined): string {
  if (requested !== undefined) {
    bucketSecondsFor(requested)
    return requested
  }
  const span = Math.max(0, scope.to.getTime() - scope.from.getTime()) / 1000
  for (const name of HISTOGRAM_BUCKETS) {
    if (span / (HISTOGRAM_BUCKET_SECONDS[name] as number) <= MAX_HISTOGRAM_BUCKETS) {
      return name
    }
  }
  return HISTOGRAM_BUCKETS[HISTOGRAM_BUCKETS.length - 1] as string
}

export function logHistogramQuery(
  search: string | SearchNode,
  scope: SearchScope,
  target: HistogramTarget,
  options: HistogramOptions = {},
): CompiledSearch {
  const bucket = options.bucket ?? DEFAULT_HISTOGRAM_BUCKET
  const seconds = bucketSecondsFor(bucket)

  const span = Math.max(0, scope.to.getTime() - scope.from.getTime()) / 1000
  const buckets = Math.ceil(span / seconds)
  if (buckets > MAX_HISTOGRAM_BUCKETS) {
    throw new Error(
      `A ${bucket} bucket over this period would be ${buckets} points, and the most is ${MAX_HISTOGRAM_BUCKETS}. Ask for a wider bucket or a shorter period.`,
    )
  }

  const from = `${assertIdentifier(target.database, 'database')}.${assertIdentifier(target.table ?? 'logs', 'table')}`
  const where = searchWhere(search, scope, options)

  const sql =
    `SELECT toStartOfInterval(timestamp, INTERVAL ${seconds} SECOND) AS ${BUCKET_COLUMN},` +
    ` level, count() AS ${EVENTS_COLUMN} FROM ${from}` +
    ` WHERE ${where.sql}` +
    ` GROUP BY ${BUCKET_COLUMN}, level` +
    ` ORDER BY ${BUCKET_COLUMN} ASC, level ASC` +
    ` LIMIT {${SCOPE_PREFIX}rows:UInt32}`

  const params: Record<string, string> = { ...where.params }
  params[`${SCOPE_PREFIX}rows`] = String(MAX_HISTOGRAM_BUCKETS * 8)

  return { sql, params }
}

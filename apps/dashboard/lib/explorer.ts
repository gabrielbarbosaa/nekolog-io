export const PERIODS = ['15m', '1h', '6h', '24h', '7d', '30d'] as const

export type Period = (typeof PERIODS)[number]

export const DEFAULT_PERIOD: Period = '1h'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const PERIOD_MS: Readonly<Record<Period, number>> = {
  '15m': 15 * MINUTE,
  '1h': HOUR,
  '6h': 6 * HOUR,
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
}

export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

export type Level = (typeof LEVELS)[number]

export type LogRow = Record<string, unknown>

export type Query = {
  environmentId: string
  search: string
  period: Period
  at: string
}

export function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value)
}

export function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value)
}

export function windowOf(period: Period, now: number): { from: Date; to: Date } {
  return { from: new Date(now - PERIOD_MS[period]), to: new Date(now) }
}

export function queryFrom(params: URLSearchParams, environmentIds: readonly string[]): Query {
  const asked = params.get('env') ?? ''
  const period = params.get('period') ?? ''

  return {
    environmentId: environmentIds.includes(asked) ? asked : (environmentIds[0] ?? ''),
    search: params.get('q') ?? '',
    period: isPeriod(period) ? period : DEFAULT_PERIOD,
    at: params.get('at') ?? '',
  }
}

export function searchOf(query: Query): string {
  const params = new URLSearchParams()
  params.set('env', query.environmentId)
  if (query.search !== '') {
    params.set('q', query.search)
  }
  if (query.period !== DEFAULT_PERIOD) {
    params.set('period', query.period)
  }
  if (query.at !== '') {
    params.set('at', query.at)
  }
  return params.toString()
}

export function textOf(row: LogRow, column: string): string {
  const value = row[column]
  return typeof value === 'string' ? value : ''
}

export function levelOf(row: LogRow): Level {
  const level = textOf(row, 'level')
  return isLevel(level) ? level : 'info'
}

export function momentOf(row: LogRow): number {
  return instantOf(textOf(row, 'timestamp'))
}

export function instantOf(stamp: string): number {
  if (stamp === '') {
    return Number.NaN
  }
  const iso = /[Zz]|[+-]\d\d:?\d\d$/.test(stamp)
    ? stamp.replace(' ', 'T')
    : `${stamp.replace(' ', 'T')}Z`
  return Date.parse(iso)
}

export function olderEnd(held: readonly LogRow[], current: Date): Date {
  const oldest = held.at(-1)
  if (oldest === undefined) {
    return current
  }
  const moment = momentOf(oldest)
  return Number.isNaN(moment) ? current : new Date(moment + 1)
}

function fingerprintOf(row: LogRow): string {
  return JSON.stringify(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : 1)))
}

export function appendPage(held: readonly LogRow[], fetched: readonly LogRow[]): LogRow[] {
  if (held.length === 0) {
    return [...fetched]
  }

  const boundary = momentOf(held[held.length - 1] as LogRow)
  const seen = new Set(
    held.filter((row) => momentOf(row) === boundary).map((row) => fingerprintOf(row)),
  )

  return [...held, ...fetched.filter((row) => !seen.has(fingerprintOf(row)))]
}

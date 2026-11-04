import { assertIdentifier } from '../log-store.ts'
import { type CompiledSearch, type CompileOptions, compileSearch } from './compile.ts'
import type { SearchNode } from './parse.ts'
import { clickHouseDateTime, SCOPE_PREFIX } from './scope.ts'

export const LOG_COLUMNS: readonly string[] = [
  'project_id',
  'environment_id',
  'timestamp',
  'received_at',
  'clock_skew_ms',
  'level',
  'message',
  'service',
  'release',
  'source',
  'trace_id',
  'span_id',
  'session_id',
  'user_id',
  'fingerprint',
  'error_type',
  'stacktrace',
  'attributes',
  'country',
]

export const SIDE_COLUMN = 'context_side'

export const DEFAULT_CONTEXT_ROWS = 25
export const MAX_CONTEXT_ROWS = 200
export const DEFAULT_CONTEXT_WINDOW_MS: number = 60 * 60 * 1000
export const MAX_CONTEXT_WINDOW_MS: number = 7 * 24 * 60 * 60 * 1000

export type LogContextScope = {
  projectId: string
  environmentId: string
}

export type LogContextOptions = CompileOptions & {
  before?: number
  after?: number
  atMost?: number
  windowMs?: number
  columns?: readonly string[]
  search?: string | SearchNode
}

function rows(value: number | undefined, fallback: number, what: string): number {
  const count = value ?? fallback
  if (!Number.isInteger(count) || count < 0 || count > MAX_CONTEXT_ROWS) {
    throw new Error(
      `Refusing to ask for ${count} ${what}: it has to be a whole number from 0 to ${MAX_CONTEXT_ROWS}.`,
    )
  }
  return count
}

function columnsOf(requested: readonly string[] | undefined): string[] {
  const wanted = requested ?? LOG_COLUMNS
  if (wanted.length === 0) {
    throw new Error('Refusing to build a query that selects no column.')
  }
  for (const column of wanted) {
    if (!LOG_COLUMNS.includes(column)) {
      throw new Error(`There is no column called ${JSON.stringify(column)} on the logs table.`)
    }
  }
  return [...wanted]
}

export function logContextQuery(
  anchor: Date,
  scope: LogContextScope,
  target: { database: string; table?: string },
  options: LogContextOptions = {},
): CompiledSearch {
  if (Number.isNaN(anchor.getTime())) {
    throw new Error('Refusing to build a query around a date that is not a date.')
  }
  if (scope.projectId === '' || scope.environmentId === '') {
    throw new Error('Refusing to build a query with no project and environment to scope it to.')
  }

  const windowMs = options.windowMs ?? DEFAULT_CONTEXT_WINDOW_MS
  if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > MAX_CONTEXT_WINDOW_MS) {
    throw new Error(
      `Refusing to look ${windowMs} ms around the anchor: it has to be a whole number from 1 to ${MAX_CONTEXT_WINDOW_MS}.`,
    )
  }

  const before = rows(options.before, DEFAULT_CONTEXT_ROWS, 'rows before')
  const after = rows(options.after, DEFAULT_CONTEXT_ROWS, 'rows after')
  const atMost = rows(options.atMost, DEFAULT_CONTEXT_ROWS, 'rows at the anchor')

  const selected = columnsOf(options.columns)
  const from = `${assertIdentifier(target.database, 'database')}.${assertIdentifier(target.table ?? 'logs', 'table')}`

  const filter = compileSearch(options.search ?? '', options)
  const params: Record<string, string> = { ...filter.params }
  for (const name of Object.keys(params)) {
    if (name.startsWith(SCOPE_PREFIX)) {
      throw new Error(`The search produced a parameter named ${name}, which the scope reserves.`)
    }
  }

  params[`${SCOPE_PREFIX}project`] = scope.projectId
  params[`${SCOPE_PREFIX}env`] = scope.environmentId
  params[`${SCOPE_PREFIX}anchor`] = clickHouseDateTime(anchor)
  params[`${SCOPE_PREFIX}window_start`] = clickHouseDateTime(new Date(anchor.getTime() - windowMs))
  params[`${SCOPE_PREFIX}window_end`] = clickHouseDateTime(new Date(anchor.getTime() + windowMs))
  params[`${SCOPE_PREFIX}before`] = String(before)
  params[`${SCOPE_PREFIX}after`] = String(after)
  params[`${SCOPE_PREFIX}at`] = String(atMost)

  const scoped = [
    `project_id = {${SCOPE_PREFIX}project:String}`,
    `environment_id = {${SCOPE_PREFIX}env:String}`,
    `timestamp >= {${SCOPE_PREFIX}window_start:DateTime64(3)}`,
    `timestamp <= {${SCOPE_PREFIX}window_end:DateTime64(3)}`,
    `(${filter.sql})`,
  ].join(' AND ')

  const columns = selected.join(', ')

  const branch = (side: number, comparison: string, order: string, limit: string): string =>
    `(SELECT ${columns}, ${side} AS ${SIDE_COLUMN} FROM ${from}` +
    ` WHERE ${scoped} AND timestamp ${comparison} {${SCOPE_PREFIX}anchor:DateTime64(3)}` +
    ` ORDER BY timestamp ${order} LIMIT {${SCOPE_PREFIX}${limit}:UInt32})`

  const sql =
    `SELECT * FROM (\n` +
    `${branch(-1, '<', 'DESC', 'before')}\n` +
    `UNION ALL\n` +
    `${branch(0, '=', 'ASC', 'at')}\n` +
    `UNION ALL\n` +
    `${branch(1, '>', 'ASC', 'after')}\n` +
    `) ORDER BY timestamp ASC, ${SIDE_COLUMN} ASC`

  return { sql, params }
}

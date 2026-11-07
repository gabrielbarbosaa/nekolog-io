import { assertIdentifier } from '../log-store.ts'
import type { CompiledSearch, CompileOptions } from './compile.ts'
import { LOG_COLUMNS } from './context.ts'
import { SCOPE_PREFIX, type SearchScope, searchWhere } from './scope.ts'

export const TRACE_ID_CHARS = 32
export const DEFAULT_TRACE_ROWS = 200
export const MAX_TRACE_ROWS = 1000
export const MAX_TRACE_SPAN_MS: number = 24 * 60 * 60 * 1000

const HEX_PATTERN = /^[0-9a-f]+$/

export type LogTraceTarget = {
  database: string
  table?: string
}

export type LogTraceOptions = CompileOptions & {
  limit?: number
  columns?: readonly string[]
}

export function traceIdOf(value: string): string {
  const lowered = value.toLowerCase()
  if (lowered === '') {
    throw new Error(
      'Refusing to look for an empty trace id: every row without a trace carries one, so it would answer with logs that have nothing to do with each other.',
    )
  }
  if (lowered.length !== TRACE_ID_CHARS || !HEX_PATTERN.test(lowered)) {
    throw new Error(
      `A trace id is ${TRACE_ID_CHARS} hexadecimal characters, and ${JSON.stringify(value)} is not.`,
    )
  }
  return lowered
}

function rowLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_TRACE_ROWS
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRACE_ROWS) {
    throw new Error(
      `Refusing to ask for ${limit} rows: it has to be a whole number from 1 to ${MAX_TRACE_ROWS}.`,
    )
  }
  return limit
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

export function logTraceQuery(
  traceId: string,
  scope: SearchScope,
  target: LogTraceTarget,
  options: LogTraceOptions = {},
): CompiledSearch {
  const wanted = traceIdOf(traceId)
  const span = scope.to.getTime() - scope.from.getTime()
  if (span > MAX_TRACE_SPAN_MS) {
    throw new Error(
      `Refusing to look for a trace across ${span} ms: the table is partitioned by day, so the window has to be at most ${MAX_TRACE_SPAN_MS} ms.`,
    )
  }

  const limit = rowLimit(options.limit)
  const columns = columnsOf(options.columns)
  const from = `${assertIdentifier(target.database, 'database')}.${assertIdentifier(target.table ?? 'logs', 'table')}`

  const where = searchWhere('', scope, options)
  const params: Record<string, string> = { ...where.params }
  params[`${SCOPE_PREFIX}trace`] = wanted
  params[`${SCOPE_PREFIX}limit`] = String(limit)

  const sql =
    `SELECT ${columns.join(', ')} FROM ${from}` +
    ` WHERE ${where.sql} AND trace_id = {${SCOPE_PREFIX}trace:String}` +
    ` ORDER BY timestamp ASC, received_at ASC` +
    ` LIMIT {${SCOPE_PREFIX}limit:UInt32}`

  return { sql, params }
}

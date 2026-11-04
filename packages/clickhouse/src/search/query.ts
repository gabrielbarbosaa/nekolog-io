import { assertIdentifier } from '../log-store.ts'
import type { CompiledSearch, CompileOptions } from './compile.ts'
import { LOG_COLUMNS } from './context.ts'
import type { SearchNode } from './parse.ts'
import { SCOPE_PREFIX, type SearchScope, searchWhere } from './scope.ts'

export const DEFAULT_SEARCH_ROWS = 100
export const MAX_SEARCH_ROWS = 1000

export type LogQueryTarget = {
  database: string
  table?: string
}

export type LogQueryOptions = CompileOptions & {
  limit?: number
  columns?: readonly string[]
  order?: 'newest' | 'oldest'
}

export function searchColumnsOf(requested: readonly string[] | undefined): string[] {
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

function rowLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_SEARCH_ROWS
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_ROWS) {
    throw new Error(
      `Refusing to ask for ${limit} rows: it has to be a whole number from 1 to ${MAX_SEARCH_ROWS}.`,
    )
  }
  return limit
}

export function logSearchQuery(
  search: string | SearchNode,
  scope: SearchScope,
  target: LogQueryTarget,
  options: LogQueryOptions = {},
): CompiledSearch {
  const limit = rowLimit(options.limit)
  const columns = searchColumnsOf(options.columns)
  const from = `${assertIdentifier(target.database, 'database')}.${assertIdentifier(target.table ?? 'logs', 'table')}`

  const where = searchWhere(search, scope, options)
  const params: Record<string, string> = { ...where.params }
  params[`${SCOPE_PREFIX}limit`] = String(limit)

  const direction = options.order === 'oldest' ? 'ASC' : 'DESC'

  const sql =
    `SELECT ${columns.join(', ')} FROM ${from}` +
    ` WHERE ${where.sql}` +
    ` ORDER BY timestamp ${direction}` +
    ` LIMIT {${SCOPE_PREFIX}limit:UInt32}`

  return { sql, params }
}

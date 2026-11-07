import 'server-only'
import { type ClickHouseConfig, queryRows } from '@nekolog-io/clickhouse/client'
import {
  DEFAULT_CONTEXT_ROWS,
  DEFAULT_SEARCH_ROWS,
  logContextQuery,
  logHistogramQuery,
  logSearchQuery,
  logTraceQuery,
  MAX_SEARCH_ROWS,
  MAX_TRACE_ROWS,
  SIDE_COLUMN,
} from '@nekolog-io/clickhouse/search'
import type { LogRow } from './explorer'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set, and the explorer cannot read a log without it.`)
  }
  return value
}

export function clickHouse(): ClickHouseConfig {
  return {
    url: required('CLICKHOUSE_URL'),
    database: required('CLICKHOUSE_DB'),
    user: required('CLICKHOUSE_READ_USER'),
    password: required('CLICKHOUSE_READ_PASSWORD'),
  }
}

export type Search = {
  projectId: string
  environmentIds: readonly string[]
  from: Date
  to: Date
  search: string
  environments: Readonly<Record<string, string>>
  limit?: number
}

export type Context = {
  projectId: string
  environmentId: string
  anchor: Date
  before?: number
  after?: number
}

export const MAX_ROWS = MAX_SEARCH_ROWS
export const DEFAULT_ROWS = DEFAULT_SEARCH_ROWS
export const CONTEXT_ROWS = DEFAULT_CONTEXT_ROWS
export const SIDE = SIDE_COLUMN

export async function searchLogs(ask: Search): Promise<LogRow[]> {
  const config = clickHouse()
  const compiled = logSearchQuery(
    ask.search,
    {
      projectId: ask.projectId,
      environmentIds: ask.environmentIds,
      from: ask.from,
      to: ask.to,
    },
    { database: config.database },
    { limit: ask.limit ?? DEFAULT_ROWS, order: 'newest', environments: ask.environments },
  )

  return queryRows<LogRow>(config, compiled.sql, { params: compiled.params })
}

export type Volume = Omit<Search, 'limit'> & { bucket: string }

export async function countVolume(ask: Volume): Promise<LogRow[]> {
  const config = clickHouse()
  const compiled = logHistogramQuery(
    ask.search,
    {
      projectId: ask.projectId,
      environmentIds: ask.environmentIds,
      from: ask.from,
      to: ask.to,
    },
    { database: config.database },
    { bucket: ask.bucket, environments: ask.environments },
  )

  return queryRows<LogRow>(config, compiled.sql, { params: compiled.params })
}

export type Trace = {
  traceId: string
  projectId: string
  environmentIds: readonly string[]
  from: Date
  to: Date
}

export const TRACE_ROWS = MAX_TRACE_ROWS

export async function traceOf(ask: Trace): Promise<LogRow[]> {
  const config = clickHouse()
  const compiled = logTraceQuery(
    ask.traceId,
    {
      projectId: ask.projectId,
      environmentIds: ask.environmentIds,
      from: ask.from,
      to: ask.to,
    },
    { database: config.database },
    { limit: TRACE_ROWS },
  )

  return queryRows<LogRow>(config, compiled.sql, { params: compiled.params })
}

export async function contextAround(ask: Context): Promise<LogRow[]> {
  const config = clickHouse()
  const compiled = logContextQuery(
    ask.anchor,
    { projectId: ask.projectId, environmentId: ask.environmentId },
    { database: config.database },
    { before: ask.before ?? CONTEXT_ROWS, after: ask.after ?? CONTEXT_ROWS },
  )

  return queryRows<LogRow>(config, compiled.sql, { params: compiled.params })
}

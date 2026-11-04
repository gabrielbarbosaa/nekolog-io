import { EXPORT_FORMATS, type ExportFormat } from '@nekolog-io/adapters'
import { assertIdentifier } from './log-store.ts'
import type { CompileOptions } from './search/compile.ts'
import { LOG_COLUMNS } from './search/context.ts'
import type { SearchNode } from './search/parse.ts'
import { type SearchScope, searchWhere } from './search/scope.ts'

export { EXPORT_FORMATS, type ExportFormat }

export const EXPORT_KEY_PREFIX = 'exports/'
export const REDACTED = '[redacted]'

export const FORMULA_LEAD_CHARACTERS: readonly string[] = ['=', '+', '-', '@', '\t', '\r']
export const FORMULA_GUARD = "'"

export const EXPORT_TEXT_COLUMNS: readonly string[] = [
  'project_id',
  'environment_id',
  'level',
  'message',
  'service',
  'release',
  'source',
  'trace_id',
  'span_id',
  'session_id',
  'user_id',
  'error_type',
  'stacktrace',
  'country',
]

export const EXPORT_PLAIN_COLUMNS: readonly string[] = [
  'timestamp',
  'received_at',
  'clock_skew_ms',
  'fingerprint',
  'attributes',
]

const CLICKHOUSE_FORMAT: Readonly<Record<ExportFormat, string>> = {
  json: 'JSONEachRow',
  xml: 'XML',
  csv: 'CSVWithNames',
}

const FILE_SUFFIX: Readonly<Record<ExportFormat, string>> = {
  json: 'ndjson.gz',
  xml: 'xml.gz',
  csv: 'csv.gz',
}

const EXPORT_ID_PATTERN = /^exp_[0-9A-HJKMNP-TV-Z]{26}$/

export type ExportDestination = {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
}

export type ExportTarget = {
  database: string
  table?: string
}

export type ExportRequest = {
  exportId: string
  format: ExportFormat
  scope: SearchScope
  destination: ExportDestination
  target: ExportTarget
  search?: string | SearchNode
  compile?: CompileOptions
}

export type CompiledExport = {
  sql: string
  select: string
  redacted: string
  params: Record<string, string>
  objectKey: string
  url: string
}

export function sqlText(value: string): string {
  return `'${value.split('\\').join('\\\\').split("'").join("\\'")}'`
}

export function exportObjectKey(exportId: string, format: ExportFormat): string {
  if (!EXPORT_ID_PATTERN.test(exportId)) {
    throw new Error(`Refusing to build an object key around ${JSON.stringify(exportId)}`)
  }
  return `${EXPORT_KEY_PREFIX}${exportId}.${FILE_SUFFIX[format]}`
}

export function guardedColumn(column: string): string {
  const leads = FORMULA_LEAD_CHARACTERS.map(sqlText).join(', ')
  const quote = sqlText(FORMULA_GUARD)
  return (
    `if(has([${leads}], substring(${column}, 1, 1)), ` +
    `concat(${quote}, ${column}), ${column}) AS ${column}`
  )
}

export function exportSelectList(format: ExportFormat): string {
  return LOG_COLUMNS.map((column) =>
    format === 'csv' && EXPORT_TEXT_COLUMNS.includes(column) ? guardedColumn(column) : column,
  ).join(', ')
}

export function withoutTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') {
    end -= 1
  }
  return value.slice(0, end)
}

function endpointOf(destination: ExportDestination, objectKey: string): string {
  const endpoint = withoutTrailingSlashes(destination.endpoint)
  if (!/^https?:\/\/[^\s'"\\]+$/.test(endpoint)) {
    throw new Error('Refusing to export to an endpoint that is not a plain http or https address')
  }
  return `${endpoint}/${objectKey}`
}

export function compileExport(request: ExportRequest): CompiledExport {
  const database = assertIdentifier(request.target.database, 'database name')
  const table = assertIdentifier(request.target.table ?? 'logs', 'table name')

  if (!EXPORT_FORMATS.includes(request.format)) {
    throw new Error(`Refusing to export in an unknown format: ${JSON.stringify(request.format)}`)
  }

  const objectKey = exportObjectKey(request.exportId, request.format)
  const url = endpointOf(request.destination, objectKey)

  if (request.destination.accessKeyId === '' || request.destination.secretAccessKey === '') {
    throw new Error('Refusing to export without credentials for the destination')
  }

  const where = searchWhere(request.search ?? '', request.scope, request.compile ?? {})

  const select =
    `SELECT ${exportSelectList(request.format)} ` +
    `FROM ${database}.${table} ` +
    `WHERE ${where.sql} ` +
    `ORDER BY ${table}.timestamp`

  const destinationOf = (key: string, secret: string): string =>
    `INSERT INTO FUNCTION s3(${sqlText(url)}, ${sqlText(key)}, ${sqlText(secret)}, ` +
    `${sqlText(CLICKHOUSE_FORMAT[request.format])}) ${select} SETTINGS s3_truncate_on_insert = 1`

  return {
    sql: destinationOf(request.destination.accessKeyId, request.destination.secretAccessKey),
    select,
    redacted: destinationOf(REDACTED, REDACTED),
    params: where.params,
    objectKey,
    url,
  }
}

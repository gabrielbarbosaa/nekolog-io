import type { LogStore, LogStoreInsertOptions, LogStoreInsertResult } from '@internal/adapters'
import { type ClickHouseConfig, execute } from './client.ts'

export const LOGS_TABLE = 'logs'

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type ClickHouseLogStoreOptions = {
  table?: string
  asyncInsert?: boolean
  waitForAsyncInsert?: boolean
  fetch?: typeof fetch
}

export function assertIdentifier(value: string, what: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Refusing to build SQL with an unsafe ${what}: ${JSON.stringify(value)}`)
  }
  return value
}

export function insertSettings(
  store: ClickHouseLogStoreOptions,
  call: LogStoreInsertOptions = {},
): Record<string, string> {
  const settings: Record<string, string> = { input_format_skip_unknown_fields: '0' }

  if (store.asyncInsert !== false) {
    settings.async_insert = '1'
    settings.wait_for_async_insert = store.waitForAsyncInsert === false ? '0' : '1'
  }

  if (call.deduplicationToken !== undefined && call.deduplicationToken !== '') {
    settings.insert_deduplication_token = call.deduplicationToken
  }

  return settings
}

export function insertStatement(database: string, table: string): string {
  return `INSERT INTO ${assertIdentifier(database, 'database')}.${assertIdentifier(table, 'table')} FORMAT JSONEachRow\n`
}

export function serialiseRows(rows: ReadonlyArray<Record<string, unknown>>): string {
  return rows.map((row) => JSON.stringify(row)).join('\n')
}

export function clickHouseLogStore(
  config: ClickHouseConfig,
  options: ClickHouseLogStoreOptions = {},
): LogStore {
  const table = options.table ?? LOGS_TABLE
  const statement = insertStatement(config.database, table)

  return {
    async insert(rows, call): Promise<LogStoreInsertResult> {
      if (rows.length === 0) {
        return { accepted: 0 }
      }

      await execute(config, `${statement}${serialiseRows(rows)}`, {
        settings: insertSettings(options, call),
        fetch: options.fetch,
      })

      return { accepted: rows.length }
    },
  }
}

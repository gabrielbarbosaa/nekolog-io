import { type ClickHouseConfig, queryRows } from '@nekolog-io/clickhouse/client'
import type { ApiDeps } from './app.ts'
import { openApiDocument } from './openapi.ts'

export function reportToConsole(error: unknown): void {
  const target = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console
  try {
    target?.error?.('[nekolog/api]', error)
  } catch {
    return
  }
}

export function coreApiDeps(
  config: ClickHouseConfig,
  extra: Omit<ApiDeps, 'query' | 'database' | 'openapi' | 'onError'>,
): ApiDeps {
  return {
    ...extra,
    database: config.database,
    query: (sql, params) =>
      queryRows<Record<string, unknown>>(config, sql, { params }) as Promise<
        Array<Record<string, unknown>>
      >,
    openapi: (origin) => openApiDocument([{ url: origin }]),
    onError: reportToConsole,
  }
}

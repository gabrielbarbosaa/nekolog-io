import type { EnvironmentUsage, UsageStore } from '@internal/adapters'
import { type ClickHouseConfig, queryRows } from './client.ts'
import { assertIdentifier } from './log-store.ts'

export const USAGE_TABLE = 'usage_per_minute'

export type ClickHouseUsageStoreOptions = {
  table?: string
  fetch?: typeof fetch
}

type UsageRow = {
  environmentId?: unknown
  events?: unknown
}

export function epochSeconds(ms: number): number {
  if (!Number.isFinite(ms)) {
    throw new Error(`Refusing to query usage from a non-numeric instant: ${String(ms)}`)
  }
  return Math.floor(ms / 1000)
}

export function usageStatement(database: string, table: string): string {
  return [
    'SELECT environment_id AS environmentId, sum(events) AS events',
    `FROM ${assertIdentifier(database, 'database')}.${assertIdentifier(table, 'table')}`,
    'WHERE minute >= toDateTime({start:Int64})',
    'GROUP BY environment_id',
  ].join(' ')
}

export function clickHouseUsageStore(
  config: ClickHouseConfig,
  options: ClickHouseUsageStoreOptions = {},
): UsageStore {
  const statement = usageStatement(config.database, options.table ?? USAGE_TABLE)

  return {
    async eventsSince(startMs): Promise<ReadonlyArray<EnvironmentUsage>> {
      const rows = await queryRows<UsageRow>(config, statement, {
        params: { start: String(epochSeconds(startMs)) },
        settings: { output_format_json_quote_64bit_integers: '0' },
        fetch: options.fetch,
      })

      const usage: EnvironmentUsage[] = []
      for (const row of rows) {
        const events = Number(row.events)
        if (typeof row.environmentId === 'string' && Number.isFinite(events)) {
          usage.push({ environmentId: row.environmentId, events })
        }
      }
      return usage
    },
  }
}

import type { IssueOccurrence } from '@nekolog-io/adapters'
import { type ClickHouseConfig, queryRows } from './client.ts'
import { assertIdentifier } from './log-store.ts'

export const LOGS_TABLE_FOR_ISSUES = 'logs'
export const DEFAULT_ISSUE_ROLLUP_LIMIT = 5000
export const MAX_ISSUE_TITLE_CHARS = 500

export type IssueRollupWindow = {
  from: number
  to: number
}

export type ClickHouseIssueSourceOptions = {
  table?: string
  limit?: number
  fetch?: typeof fetch
}

export type IssueSource = {
  occurrencesBetween(window: IssueRollupWindow): Promise<ReadonlyArray<IssueOccurrence>>
}

type RollupRow = {
  projectId?: unknown
  environmentId?: unknown
  fingerprint?: unknown
  events?: unknown
  firstSeen?: unknown
  lastSeen?: unknown
  level?: unknown
  errorType?: unknown
  title?: unknown
  service?: unknown
  release?: unknown
}

export function rollupStatement(database: string, table: string): string {
  const from = `${assertIdentifier(database, 'database')}.${assertIdentifier(table, 'table')}`

  return [
    'SELECT project_id AS projectId, environment_id AS environmentId,',
    'toString(fingerprint) AS fingerprint,',
    'toString(count()) AS events,',
    'toString(toUnixTimestamp64Milli(min(timestamp))) AS firstSeen,',
    'toString(toUnixTimestamp64Milli(max(timestamp))) AS lastSeen,',
    'argMax(level, timestamp) AS level,',
    'argMax(error_type, timestamp) AS errorType,',
    'argMax(message, timestamp) AS title,',
    'argMax(service, timestamp) AS service,',
    'argMax(release, timestamp) AS release',
    `FROM ${from}`,
    `WHERE ${table}.fingerprint != 0`,
    'AND received_at >= fromUnixTimestamp64Milli({from:Int64})',
    'AND received_at < fromUnixTimestamp64Milli({to:Int64})',
    'GROUP BY project_id, environment_id, fingerprint',
    'ORDER BY events DESC',
    'LIMIT {limit:UInt32}',
  ].join(' ')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function occurrenceFrom(row: RollupRow): IssueOccurrence | undefined {
  const projectId = text(row.projectId)
  const environmentId = text(row.environmentId)
  const fingerprint = text(row.fingerprint)
  const events = Number(row.events)
  const firstSeen = Number(row.firstSeen)
  const lastSeen = Number(row.lastSeen)

  if (projectId === '' || environmentId === '' || !/^[1-9][0-9]*$/.test(fingerprint)) {
    return undefined
  }
  if (!Number.isFinite(events) || events <= 0) {
    return undefined
  }
  if (!Number.isFinite(firstSeen) || !Number.isFinite(lastSeen) || lastSeen < firstSeen) {
    return undefined
  }

  const title = text(row.title).slice(0, MAX_ISSUE_TITLE_CHARS)

  return {
    projectId,
    environmentId,
    fingerprint,
    events,
    firstSeen,
    lastSeen,
    level: text(row.level),
    errorType: text(row.errorType),
    title: title === '' ? text(row.errorType) || 'Error' : title,
    service: text(row.service),
    release: text(row.release),
  }
}

export function clickHouseIssueSource(
  config: ClickHouseConfig,
  options: ClickHouseIssueSourceOptions = {},
): IssueSource {
  const statement = rollupStatement(config.database, options.table ?? LOGS_TABLE_FOR_ISSUES)
  const limit = options.limit ?? DEFAULT_ISSUE_ROLLUP_LIMIT

  return {
    async occurrencesBetween(window): Promise<ReadonlyArray<IssueOccurrence>> {
      if (
        !Number.isFinite(window.from) ||
        !Number.isFinite(window.to) ||
        window.to <= window.from
      ) {
        throw new Error('Refusing to roll issues up over a window that does not move forward.')
      }

      const rows = await queryRows<RollupRow>(config, statement, {
        params: {
          from: String(Math.floor(window.from)),
          to: String(Math.floor(window.to)),
          limit: String(limit),
        },
        fetch: options.fetch,
      })

      const occurrences: IssueOccurrence[] = []
      for (const row of rows) {
        const one = occurrenceFrom(row)
        if (one !== undefined) {
          occurrences.push(one)
        }
      }
      return occurrences
    },
  }
}

import type { ExportFormat, ExportOutcome, ExportStore, PendingExport } from '../export-store.ts'
import type { SqlRunner } from '../issues/sql-issue-store.ts'

export type SqlExportStoreOptions = {
  staleAfterMs?: number
}

export const DEFAULT_STALE_AFTER_MS: number = 15 * 60 * 1000

const CLAIM = `
update exports set status = 'running', started_at = $2::timestamptz
where id in (
  select id from exports
  where status = 'pending'
     or (status = 'running' and started_at < $2::timestamptz - make_interval(secs => $3::double precision))
  order by created_at
  limit $1
  for update skip locked
)
returning id, project_id, environment_id, format, query,
  extract(epoch from range_from) * 1000 as range_from_ms,
  extract(epoch from range_to) * 1000 as range_to_ms
`

const MARK_READY = `
update exports
set status = 'ready', object_key = $2, byte_size = $3, row_count = $4,
    failure = null, finished_at = $5::timestamptz
where id = $1 and status = 'running'
`

const MARK_FAILED = `
update exports
set status = 'failed', failure = $2, finished_at = $3::timestamptz
where id = $1 and status = 'running'
`

const EXPIRE = `
update exports set status = 'expired'
where id in (
  select id from exports
  where status = 'ready' and expires_at <= $1::timestamptz
  order by expires_at
  limit $2
  for update skip locked
)
returning object_key
`

function moment(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to stamp an export at ${String(value)}`)
  }
  return new Date(value).toISOString()
}

function numberFrom(value: unknown): number {
  const asNumber = typeof value === 'string' ? Number(value) : value
  if (typeof asNumber !== 'number' || !Number.isFinite(asNumber)) {
    throw new Error(`An export row carried ${JSON.stringify(value)} where a number belongs`)
  }
  return asNumber
}

function textFrom(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`An export row carried ${JSON.stringify(value)} as its ${field}`)
  }
  return value
}

export function sqlExportStore(run: SqlRunner, options: SqlExportStoreOptions = {}): ExportStore {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS

  return {
    async claim(limit: number, now: number): Promise<ReadonlyArray<PendingExport>> {
      if (limit <= 0) {
        return []
      }

      const rows = await run(CLAIM, [limit, moment(now), staleAfterMs / 1000])

      return rows.map((row) => ({
        id: textFrom(row.id, 'id'),
        projectId: textFrom(row.project_id, 'project id'),
        environmentId: textFrom(row.environment_id, 'environment id'),
        format: textFrom(row.format, 'format') as ExportFormat,
        query: textFrom(row.query, 'query'),
        rangeFrom: numberFrom(row.range_from_ms),
        rangeTo: numberFrom(row.range_to_ms),
      }))
    },

    async markReady(id: string, outcome: ExportOutcome, at: number): Promise<void> {
      await run(MARK_READY, [id, outcome.objectKey, outcome.byteSize, outcome.rowCount, moment(at)])
    },

    async markFailed(id: string, reason: string, at: number): Promise<void> {
      await run(MARK_FAILED, [id, reason, moment(at)])
    },

    async expire(now: number, limit: number): Promise<ReadonlyArray<string>> {
      if (limit <= 0) {
        return []
      }

      const rows = await run(EXPIRE, [moment(now), limit])

      return rows
        .map((row) => row.object_key)
        .filter((key): key is string => typeof key === 'string' && key !== '')
    },
  }
}

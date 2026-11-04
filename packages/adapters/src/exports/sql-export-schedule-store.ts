import type {
  DueSchedule,
  ExportCadence,
  ExportFormat,
  ExportScheduleStore,
  ScheduledExport,
} from '../export-store.ts'
import type { SqlRunner } from '../issues/sql-issue-store.ts'

const DUE = `
select id, project_id, environment_id, format, cadence, query, created_by
from export_schedules
where disabled_at is null
  and cadence = $1
  and coalesce(last_run_at, created_at) < $2::timestamptz
order by coalesce(last_run_at, created_at)
limit $3
`

const ENQUEUE = `
with due as (
  select id, project_id, environment_id, format, query, created_by
  from export_schedules
  where id = $1
    and disabled_at is null
    and coalesce(last_run_at, created_at) < $2::timestamptz
  for update skip locked
),
stamped as (
  update export_schedules set last_run_at = $2::timestamptz
  where id in (select id from due)
  returning id
)
insert into exports (
  id, project_id, environment_id, schedule_id, requested_by,
  format, query, range_from, range_to, expires_at
)
select $3, due.project_id, due.environment_id, due.id, due.created_by,
  due.format, due.query, $4::timestamptz, $5::timestamptz, $6::timestamptz
from due join stamped on stamped.id = due.id
returning id
`

function moment(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to schedule an export at ${String(value)}`)
  }
  return new Date(value).toISOString()
}

function textFrom(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`An export schedule carried ${JSON.stringify(value)} as its ${field}`)
  }
  return value
}

export function sqlExportScheduleStore(run: SqlRunner): ExportScheduleStore {
  return {
    async due(
      cadence: ExportCadence,
      boundary: number,
      limit: number,
    ): Promise<ReadonlyArray<DueSchedule>> {
      if (limit <= 0) {
        return []
      }

      const rows = await run(DUE, [cadence, moment(boundary), limit])

      return rows.map((row) => ({
        id: textFrom(row.id, 'id'),
        projectId: textFrom(row.project_id, 'project id'),
        environmentId: textFrom(row.environment_id, 'environment id'),
        format: textFrom(row.format, 'format') as ExportFormat,
        cadence: textFrom(row.cadence, 'cadence') as ExportCadence,
        query: textFrom(row.query, 'query'),
        createdBy: row.created_by === null ? null : textFrom(row.created_by, 'author'),
      }))
    },

    async enqueue(one: ScheduledExport): Promise<boolean> {
      const rows = await run(ENQUEUE, [
        one.scheduleId,
        moment(one.stampedAt),
        one.exportId,
        moment(one.rangeFrom),
        moment(one.rangeTo),
        moment(one.expiresAt),
      ])

      return rows.length > 0
    },
  }
}

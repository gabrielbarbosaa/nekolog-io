import {
  DEFAULT_ISSUE_ROWS,
  decodeIssueCursor,
  encodeIssueCursor,
  type IssuePage,
  type IssueQuery,
  type IssueReader,
  type IssueSummary,
  MAX_ISSUE_ROWS,
} from '../issue-reader.ts'
import { ISSUE_STATUSES, type IssueStatus } from '../issue-store.ts'
import type { SqlRunner } from './sql-issue-store.ts'

const LIST_ISSUES = `
select
  i.id as id,
  i.fingerprint as fingerprint,
  i.status::text as status,
  i.title as title,
  i.error_type as error_type,
  i.service as service,
  e.events as events,
  e.first_seen_at as first_seen_at,
  e.last_seen_at as last_seen_at,
  i.resolved_at as resolved_at,
  i.regressed_at as regressed_at
from issues i
join issue_environments e on e.issue_id = i.id
where i.project_id = $1
  and e.environment_id = $2
  and i.status::text = any($3::text[])
  and ($4::timestamptz is null or e.last_seen_at >= $4::timestamptz)
  and ($5::timestamptz is null or e.last_seen_at < $5::timestamptz)
  and (
    $6::timestamptz is null
    or (e.last_seen_at, i.id) < ($6::timestamptz, $7::text)
  )
order by e.last_seen_at desc, i.id desc
limit $8
`

function rowLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_ISSUE_ROWS
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ISSUE_ROWS) {
    throw new Error(
      `Refusing to ask for ${limit} issues: it has to be a whole number from 1 to ${MAX_ISSUE_ROWS}.`,
    )
  }
  return limit
}

function statusesOf(wanted: readonly IssueStatus[] | undefined): string[] {
  if (wanted === undefined || wanted.length === 0) {
    return [...ISSUE_STATUSES]
  }
  for (const status of wanted) {
    if (!ISSUE_STATUSES.includes(status)) {
      throw new Error(`There is no issue status called ${JSON.stringify(status)}.`)
    }
  }
  return [...new Set(wanted)]
}

function moment(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  throw new Error('An issue came back from the database without a moment on it.')
}

function optionalMoment(value: unknown): string | null {
  return value === null || value === undefined ? null : moment(value)
}

function bound(value: Date | undefined, what: string): string | null {
  if (value === undefined) {
    return null
  }
  if (Number.isNaN(value.getTime())) {
    throw new Error(`Refusing to list issues ${what} a moment that is not a moment.`)
  }
  return value.toISOString()
}

function summaryOf(row: Record<string, unknown>): IssueSummary {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    status: String(row.status) as IssueStatus,
    title: String(row.title),
    errorType: String(row.error_type ?? ''),
    service: String(row.service ?? ''),
    events: Number(row.events ?? 0),
    firstSeen: moment(row.first_seen_at),
    lastSeen: moment(row.last_seen_at),
    resolvedAt: optionalMoment(row.resolved_at),
    regressedAt: optionalMoment(row.regressed_at),
  }
}

export function sqlIssueReader(run: SqlRunner): IssueReader {
  return {
    async list(query: IssueQuery): Promise<IssuePage> {
      if (query.projectId === '' || query.environmentId === '') {
        throw new Error('Refusing to list issues with no project and environment to scope them to.')
      }

      const limit = rowLimit(query.limit)
      const after =
        query.cursor === undefined || query.cursor === null ? null : decodeIssueCursor(query.cursor)

      const rows = await run(LIST_ISSUES, [
        query.projectId,
        query.environmentId,
        statusesOf(query.statuses),
        bound(query.since, 'since'),
        bound(query.until, 'until'),
        after === null ? null : after.lastSeen,
        after === null ? null : after.id,
        limit + 1,
      ])

      const page = rows.slice(0, limit).map(summaryOf)
      const more = rows.length > limit
      const last = page[page.length - 1]

      return {
        issues: page,
        nextCursor: more && last !== undefined ? encodeIssueCursor(last.lastSeen, last.id) : null,
      }
    },
  }
}

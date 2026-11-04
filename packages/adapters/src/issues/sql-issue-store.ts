import type { IssueOccurrence, IssueRollup, IssueStore } from '../issue-store.ts'

export type SqlRunner = (
  text: string,
  params: readonly unknown[],
) => Promise<ReadonlyArray<Record<string, unknown>>>

export type SqlIssueStoreOptions = {
  newId?: () => string
}

export const ISSUE_ID_PREFIX = 'iss_'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

type CryptoLike = { getRandomValues?: (array: Uint8Array) => Uint8Array }

function randomBytes(size: number): Uint8Array {
  const source = (globalThis as { crypto?: CryptoLike }).crypto
  if (!source?.getRandomValues) {
    throw new Error('This runtime has no crypto.getRandomValues, so it cannot mint an issue id')
  }
  return source.getRandomValues(new Uint8Array(size))
}

export function newIssueId(): string {
  const bytes = randomBytes(26)
  let suffix = ''
  for (const byte of bytes) {
    suffix += CROCKFORD[byte % 32]
  }
  return `${ISSUE_ID_PREFIX}${suffix}`
}

const UPSERT_ISSUE = `
with seen as (
  select status, resolved_at from issues where project_id = $2 and fingerprint = $3
),
upserted as (
  insert into issues (
    id, project_id, fingerprint, status, title, error_type, service,
    events, first_seen_at, last_seen_at
  )
  values ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9)
  on conflict (project_id, fingerprint) do update set
    events = issues.events + excluded.events,
    first_seen_at = least(issues.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(issues.last_seen_at, excluded.last_seen_at),
    title = excluded.title,
    error_type = excluded.error_type,
    service = excluded.service,
    status = case
      when issues.status = 'resolved' and excluded.last_seen_at > issues.resolved_at then 'open'
      else issues.status
    end,
    regressed_at = case
      when issues.status = 'resolved' and excluded.last_seen_at > issues.resolved_at
        then excluded.last_seen_at
      else issues.regressed_at
    end
  returning id, (xmax = 0) as created
)
select
  upserted.id as id,
  upserted.created as created,
  coalesce(seen.status = 'resolved' and $9::timestamptz > seen.resolved_at, false) as reopened
from upserted left join seen on true
`

const UPSERT_ENVIRONMENT = `
insert into issue_environments (issue_id, environment_id, events, first_seen_at, last_seen_at)
values ($1, $2, $3, $4, $5)
on conflict (issue_id, environment_id) do update set
  events = issue_environments.events + excluded.events,
  first_seen_at = least(issue_environments.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(issue_environments.last_seen_at, excluded.last_seen_at)
`

function moment(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to record an occurrence seen at ${String(value)}`)
  }
  return new Date(value).toISOString()
}

export function sqlIssueStore(run: SqlRunner, options: SqlIssueStoreOptions = {}): IssueStore {
  const newId = options.newId ?? newIssueId

  return {
    async record(occurrences: ReadonlyArray<IssueOccurrence>): Promise<IssueRollup> {
      const rollup: IssueRollup = { created: 0, updated: 0, reopened: 0 }

      for (const one of occurrences) {
        const firstSeen = moment(one.firstSeen)
        const lastSeen = moment(one.lastSeen)

        const rows = await run(UPSERT_ISSUE, [
          newId(),
          one.projectId,
          one.fingerprint,
          one.title,
          one.errorType,
          one.service,
          one.events,
          firstSeen,
          lastSeen,
        ])

        const row = rows[0]
        if (row === undefined) {
          continue
        }

        if (row.created === true) {
          rollup.created += 1
        } else {
          rollup.updated += 1
        }
        if (row.reopened === true) {
          rollup.reopened += 1
        }

        await run(UPSERT_ENVIRONMENT, [row.id, one.environmentId, one.events, firstSeen, lastSeen])
      }

      return rollup
    },
  }
}

import { crockfordId } from '../ids.ts'
import type { SqlRunner } from '../issues/sql-issue-store.ts'
import {
  assertCommit,
  assertReleasedAt,
  assertVersion,
  type RecordedRelease,
  type Release,
  type ReleaseInput,
  type ReleaseStore,
} from '../release-store.ts'

export const RELEASE_ID_PREFIX = 'rel_'

export function newReleaseId(): string {
  return crockfordId(RELEASE_ID_PREFIX, 'a release id')
}

export type SqlReleaseStoreOptions = {
  newId?: () => string
  now?: () => number
}

const RECORD_RELEASE = `
insert into releases (id, project_id, environment_id, version, commit, released_at)
values ($1, $2, $3, $4, $5, $6::timestamptz)
on conflict (environment_id, version) do update set
  commit = coalesce(excluded.commit, releases.commit),
  released_at = least(releases.released_at, excluded.released_at)
returning
  id,
  project_id,
  environment_id,
  version,
  commit,
  sourcemap_count,
  released_at,
  created_at,
  (xmax = 0) as created
`

function moment(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  throw new Error('A release came back from the database without a moment on it.')
}

function releaseOf(row: Record<string, unknown>): Release {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    environmentId: String(row.environment_id),
    version: String(row.version),
    commit: row.commit === null || row.commit === undefined ? null : String(row.commit),
    sourcemapCount: Number(row.sourcemap_count ?? 0),
    releasedAt: moment(row.released_at),
    createdAt: moment(row.created_at),
  }
}

export function sqlReleaseStore(
  run: SqlRunner,
  options: SqlReleaseStoreOptions = {},
): ReleaseStore {
  const newId = options.newId ?? newReleaseId
  const clock = options.now ?? Date.now

  return {
    async record(input: ReleaseInput): Promise<RecordedRelease> {
      if (input.projectId === '' || input.environmentId === '') {
        throw new Error('Refusing to record a release with no project and environment.')
      }

      const version = assertVersion(input.version)
      const commit = assertCommit(input.commit)
      const releasedAt = assertReleasedAt(input.releasedAt, clock())

      const rows = await run(RECORD_RELEASE, [
        newId(),
        input.projectId,
        input.environmentId,
        version,
        commit,
        releasedAt.toISOString(),
      ])

      const row = rows[0]
      if (row === undefined) {
        throw new Error('The database accepted the release but returned no row.')
      }

      return { release: releaseOf(row), created: row.created === true }
    },
  }
}

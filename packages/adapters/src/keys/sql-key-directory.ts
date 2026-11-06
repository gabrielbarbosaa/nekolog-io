import type { SqlRunner } from '../issues/sql-issue-store.ts'
import type { KeyRecord } from '../key-store.ts'
import type { PublishedKey } from './publish.ts'

export const LIVE_KEYS = `
  select api_keys.id, api_keys.hash, api_keys.scopes,
         environments.id as environment_id, environments.project_id,
         environments.retention_days, environments.min_level, environments.sample_rate,
         environments.origin_allowlist, environments.redaction_rules
  from api_keys
  join environments on environments.id = api_keys.environment_id
  join projects on projects.id = environments.project_id
  join organizations on organizations.id = projects.organization_id
  where api_keys.revoked_at is null
    and organizations.suspended_at is null
  order by api_keys.id
`

export const STAMP_LAST_USED = `
  update api_keys set last_used_at = greatest(coalesce(last_used_at, stamped.at), stamped.at)
  from (select unnest($1::text[]) as id, unnest($2::timestamptz[]) as at) as stamped
  where api_keys.id = stamped.id
    and (api_keys.last_used_at is null or api_keys.last_used_at < stamped.at)
  returning api_keys.id
`

export type KeyUsageStamp = {
  keyId: string
  at: Date
}

export type KeyDirectory = {
  live(): Promise<PublishedKey[]>
  stampLastUsed(stamps: ReadonlyArray<KeyUsageStamp>): Promise<number>
}

const WRITABLE_SCOPES: ReadonlyArray<KeyRecord['scopes'][number]> = ['logs:write', 'logs:read']

function scopesOf(value: unknown): KeyRecord['scopes'] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(String)
    .filter((scope): scope is KeyRecord['scopes'][number] =>
      (WRITABLE_SCOPES as readonly string[]).includes(scope),
    )
}

export function keyRecordOf(row: Record<string, unknown>): PublishedKey {
  const record: KeyRecord = {
    projectId: String(row.project_id),
    environmentId: String(row.environment_id),
    keyId: String(row.id),
    scopes: scopesOf(row.scopes),
    originAllowlist: Array.isArray(row.origin_allowlist)
      ? (row.origin_allowlist as unknown[]).map(String)
      : null,
    blocked: false,
    retentionDays: Number(row.retention_days),
    minLevel: String(row.min_level),
    sampleRate: Number(row.sample_rate),
  }

  if (row.redaction_rules !== null && row.redaction_rules !== undefined) {
    record.redaction = row.redaction_rules
  }

  return { keyHash: String(row.hash), record }
}

export function sqlKeyDirectory(run: SqlRunner): KeyDirectory {
  return {
    async live() {
      return (await run(LIVE_KEYS, [])).map(keyRecordOf)
    },

    async stampLastUsed(stamps) {
      if (stamps.length === 0) {
        return 0
      }
      const rows = await run(STAMP_LAST_USED, [
        stamps.map((stamp) => stamp.keyId),
        stamps.map((stamp) => stamp.at.toISOString()),
      ])
      return rows.length
    },
  }
}

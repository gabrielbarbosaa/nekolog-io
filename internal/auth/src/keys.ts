import {
  type ApiKeyKind,
  generateApiKey,
  hashApiKey,
  PUBLIC_KEY_PREFIX,
  SECRET_KEY_PREFIX,
} from '@nekolog-io/adapters'
import { newId } from './signup.ts'
import type { SqlRunner } from './users.ts'

export const API_KEY_ID_PREFIX = 'key_'

export const KEY_SCOPES = ['logs:write', 'logs:read'] as const
export type KeyScope = (typeof KEY_SCOPES)[number]

export const PUBLIC_SCOPES: ReadonlyArray<KeyScope> = ['logs:write']

export const HINT_TAIL_CHARS = 4

export const MAX_LIVE_KEYS_PER_ENVIRONMENT = 10

export function isKeyKind(value: string): value is ApiKeyKind {
  return value === 'public' || value === 'secret'
}

export function readScopes(input: unknown, kind: ApiKeyKind): ReadonlyArray<KeyScope> | undefined {
  if (kind === 'public') {
    return input === undefined || sameScopes(input, PUBLIC_SCOPES) ? PUBLIC_SCOPES : undefined
  }
  if (input === undefined) {
    return ['logs:write']
  }
  if (!Array.isArray(input) || input.length === 0) {
    return undefined
  }

  const read: KeyScope[] = []
  for (const one of input as unknown[]) {
    if (typeof one !== 'string' || !(KEY_SCOPES as readonly string[]).includes(one)) {
      return undefined
    }
    if (!read.includes(one as KeyScope)) {
      read.push(one as KeyScope)
    }
  }
  return read
}

function sameScopes(input: unknown, wanted: ReadonlyArray<KeyScope>): boolean {
  return (
    Array.isArray(input) &&
    input.length === wanted.length &&
    wanted.every((scope) => (input as unknown[]).includes(scope))
  )
}

export function hintFor(value: string): string {
  const prefix = value.startsWith(PUBLIC_KEY_PREFIX) ? PUBLIC_KEY_PREFIX : SECRET_KEY_PREFIX
  return `${prefix}…${value.slice(-HINT_TAIL_CHARS)}`
}

const ENVIRONMENT_IS_OURS = `exists (
      select 1 from environments
      join projects on projects.id = environments.project_id
      where environments.id = $2 and projects.id = $3 and projects.organization_id = $1
    )`

const MINT = `
  insert into api_keys (id, environment_id, kind, hash, hint, scopes)
  select $4, $2, $5, $6, $7, $8::text[]
  where ${ENVIRONMENT_IS_OURS}
    and (
      select count(*) from api_keys live
      where live.environment_id = $2 and live.revoked_at is null
    ) < $9::int
  returning id
`

const LIST_KEYS = `
  select api_keys.id, api_keys.environment_id, api_keys.kind, api_keys.hint,
         api_keys.scopes, api_keys.last_used_at, api_keys.revoked_at, api_keys.created_at,
         environments.name as environment
  from api_keys
  join environments on environments.id = api_keys.environment_id
  where environments.project_id = $2
    and exists (select 1 from projects where projects.id = $2 and projects.organization_id = $1)
  order by environments.name, api_keys.created_at desc, api_keys.id
`

const ONE_KEY = `
  select api_keys.id, api_keys.environment_id, api_keys.kind, api_keys.scopes,
         api_keys.revoked_at
  from api_keys
  join environments on environments.id = api_keys.environment_id
  where api_keys.id = $3 and environments.project_id = $2
    and exists (select 1 from projects where projects.id = $2 and projects.organization_id = $1)
  limit 1
`

const REVOKE = `
  update api_keys set revoked_at = now()
  from environments
  where environments.id = api_keys.environment_id
    and api_keys.id = $3 and api_keys.revoked_at is null
    and environments.project_id = $2
    and exists (select 1 from projects where projects.id = $2 and projects.organization_id = $1)
  returning api_keys.id, api_keys.hint, api_keys.environment_id
`

const ROTATE = `
  with retired as (
    update api_keys set revoked_at = now()
    from environments
    where environments.id = api_keys.environment_id
      and api_keys.id = $3 and api_keys.revoked_at is null
      and environments.project_id = $2
      and exists (select 1 from projects where projects.id = $2 and projects.organization_id = $1)
    returning api_keys.id, api_keys.environment_id, api_keys.kind, api_keys.scopes
  )
  insert into api_keys (id, environment_id, kind, hash, hint, scopes)
  select $4, retired.environment_id, retired.kind, $5, $6, retired.scopes from retired
  returning id, environment_id
`

export type ApiKeySummary = {
  id: string
  environmentId: string
  environment: string
  kind: ApiKeyKind
  hint: string
  scopes: ReadonlyArray<KeyScope>
  lastUsedAt: Date | undefined
  revokedAt: Date | undefined
  createdAt: Date
}

function dateOrNot(value: unknown): Date | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  return value instanceof Date ? value : new Date(String(value))
}

function scopesOf(value: unknown): ReadonlyArray<KeyScope> {
  return Array.isArray(value)
    ? (value as unknown[])
        .map(String)
        .filter((scope): scope is KeyScope => (KEY_SCOPES as readonly string[]).includes(scope))
    : []
}

function kindOf(value: unknown): ApiKeyKind {
  const kind = String(value)
  if (!isKeyKind(kind)) {
    throw new Error(`the database holds a key kind this code does not know: ${kind}`)
  }
  return kind
}

export type Minted =
  | { outcome: 'minted'; keyId: string; value: string; hint: string }
  | { outcome: 'bad-scopes' }
  | { outcome: 'no-such-environment' }
  | { outcome: 'too-many' }

export async function mintKey(
  run: SqlRunner,
  input: {
    organizationId: string
    projectId: string
    environmentId: string
    kind: ApiKeyKind
    scopes?: unknown
  },
): Promise<Minted> {
  const scopes = readScopes(input.scopes, input.kind)
  if (scopes === undefined) {
    return { outcome: 'bad-scopes' }
  }

  const value = generateApiKey(input.kind)
  const keyId = newId(API_KEY_ID_PREFIX)
  const rows = await run(MINT, [
    input.organizationId,
    input.environmentId,
    input.projectId,
    keyId,
    input.kind,
    await hashApiKey(value),
    hintFor(value),
    [...scopes],
    MAX_LIVE_KEYS_PER_ENVIRONMENT,
  ])

  if (rows.length === 0) {
    return { outcome: 'too-many' }
  }
  return { outcome: 'minted', keyId, value, hint: hintFor(value) }
}

export async function listKeys(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
): Promise<ApiKeySummary[]> {
  const rows = await run(LIST_KEYS, [organizationId, projectId])
  return rows.map((row) => ({
    id: String(row.id),
    environmentId: String(row.environment_id),
    environment: String(row.environment),
    kind: kindOf(row.kind),
    hint: String(row.hint),
    scopes: scopesOf(row.scopes),
    lastUsedAt: dateOrNot(row.last_used_at),
    revokedAt: dateOrNot(row.revoked_at),
    createdAt: dateOrNot(row.created_at) ?? new Date(0),
  }))
}

export async function findKey(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
  keyId: string,
): Promise<{ id: string; environmentId: string; kind: ApiKeyKind; revoked: boolean } | undefined> {
  const rows = await run(ONE_KEY, [organizationId, projectId, keyId])
  const row = rows[0]
  return row === undefined
    ? undefined
    : {
        id: String(row.id),
        environmentId: String(row.environment_id),
        kind: kindOf(row.kind),
        revoked: row.revoked_at !== null && row.revoked_at !== undefined,
      }
}

export async function revokeKey(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
  keyId: string,
): Promise<{ hint: string; environmentId: string } | undefined> {
  const rows = await run(REVOKE, [organizationId, projectId, keyId])
  const row = rows[0]
  return row === undefined
    ? undefined
    : { hint: String(row.hint), environmentId: String(row.environment_id) }
}

export type Rotated =
  | { outcome: 'rotated'; keyId: string; value: string; hint: string; environmentId: string }
  | { outcome: 'no-such-key' }

export async function rotateKey(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
  keyId: string,
): Promise<Rotated> {
  const existing = await findKey(run, organizationId, projectId, keyId)
  if (existing === undefined || existing.revoked) {
    return { outcome: 'no-such-key' }
  }

  const value = generateApiKey(existing.kind)
  const replacement = newId(API_KEY_ID_PREFIX)
  const rows = await run(ROTATE, [
    organizationId,
    projectId,
    keyId,
    replacement,
    await hashApiKey(value),
    hintFor(value),
  ])

  const row = rows[0]
  return row === undefined
    ? { outcome: 'no-such-key' }
    : {
        outcome: 'rotated',
        keyId: replacement,
        value,
        hint: hintFor(value),
        environmentId: String(row.environment_id),
      }
}

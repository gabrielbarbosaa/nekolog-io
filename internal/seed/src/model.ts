import { type ApiKeyKind, generateApiKey, hashApiKey, type KeyRecord } from '@internal/adapters'
import {
  ENVIRONMENT_PREFIX,
  id,
  KEY_PREFIX,
  ORGANIZATION_PREFIX,
  PROJECT_PREFIX,
  type RandomBytes,
} from './ids.ts'

export const DEFAULT_ENVIRONMENTS: ReadonlyArray<string> = ['production', 'staging', 'development']

export const DEFAULT_RETENTION_DAYS = 7
export const MAX_NAME_CHARS = 60

const ENVIRONMENT_NAME = /^[a-z][a-z0-9-]{0,30}$/

export type Scope = KeyRecord['scopes'][number]

export const SCOPES_FOR: Record<ApiKeyKind, ReadonlyArray<Scope>> = {
  public: ['logs:write'],
  secret: ['logs:write', 'logs:read'],
}

export type MintedKey = {
  id: string
  kind: ApiKeyKind
  value: string
  hash: string
  scopes: ReadonlyArray<Scope>
  createdAt: number
}

export type SeedEnvironment = {
  id: string
  name: string
  retentionDays: number
  originAllowlist: ReadonlyArray<string> | null
  keys: MintedKey[]
}

export type Seed = {
  organization: { id: string; name: string }
  project: { id: string; name: string }
  environments: SeedEnvironment[]
  createdAt: number
}

export type MintOptions = {
  randomBytes?: RandomBytes
  generateKey?: (kind: ApiKeyKind) => string
  hash?: (value: string) => Promise<string>
}

export type BuildSeedOptions = MintOptions & {
  organization: string
  project: string
  environments?: ReadonlyArray<string>
  retentionDays?: number
  originAllowlist?: ReadonlyArray<string> | null
  now?: () => number
}

export function assertName(value: string, what: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`The ${what} needs a name`)
  }
  if (trimmed.length > MAX_NAME_CHARS) {
    throw new Error(`The ${what} name has to be at most ${MAX_NAME_CHARS} characters`)
  }
  return trimmed
}

export function assertEnvironmentNames(names: ReadonlyArray<string>): ReadonlyArray<string> {
  if (names.length === 0) {
    throw new Error('A project needs at least one environment')
  }
  for (const name of names) {
    if (!ENVIRONMENT_NAME.test(name)) {
      throw new Error(
        `"${name}" cannot be an environment name: use lowercase letters, digits and dashes`,
      )
    }
  }
  if (new Set(names).size !== names.length) {
    throw new Error('Two environments cannot share a name')
  }
  return names
}

export function assertRetentionDays(days: number): number {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`The retention has to be a whole number of days, got ${days}`)
  }
  return days
}

export async function mintKey(
  kind: ApiKeyKind,
  at: number,
  options: MintOptions = {},
): Promise<MintedKey> {
  const value = (options.generateKey ?? generateApiKey)(kind)
  return {
    id: id(KEY_PREFIX, at, options.randomBytes),
    kind,
    value,
    hash: await (options.hash ?? hashApiKey)(value),
    scopes: SCOPES_FOR[kind],
    createdAt: at,
  }
}

export async function buildSeed(options: BuildSeedOptions): Promise<Seed> {
  const organization = assertName(options.organization, 'organization')
  const project = assertName(options.project, 'project')
  const names = assertEnvironmentNames(options.environments ?? DEFAULT_ENVIRONMENTS)
  const retentionDays = assertRetentionDays(options.retentionDays ?? DEFAULT_RETENTION_DAYS)
  const at = (options.now ?? Date.now)()

  const environments: SeedEnvironment[] = []
  for (const name of names) {
    const keys: MintedKey[] = []
    for (const kind of ['public', 'secret'] as const) {
      keys.push(await mintKey(kind, at, options))
    }
    environments.push({
      id: id(ENVIRONMENT_PREFIX, at, options.randomBytes),
      name,
      retentionDays,
      originAllowlist: options.originAllowlist ?? null,
      keys,
    })
  }

  return {
    organization: { id: id(ORGANIZATION_PREFIX, at, options.randomBytes), name: organization },
    project: { id: id(PROJECT_PREFIX, at, options.randomBytes), name: project },
    environments,
    createdAt: at,
  }
}

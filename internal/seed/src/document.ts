import { type ApiKeyKind, parseRedactionRules, type RedactionRules } from '@nekolog-io/adapters'
import {
  assertMinLevel,
  assertSampleRate,
  type EnvironmentSettings,
  HISTORICAL_SETTINGS,
  type Scope,
  type Seed,
} from './model.ts'

export const SEED_VERSION = 2
export const READABLE_SEED_VERSIONS: ReadonlyArray<number> = [1, 2]
export const HINT_CHARS = 4

export class SeedFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedFormatError'
  }
}

export type SeedKeyEntry = {
  id: string
  kind: ApiKeyKind
  hash: string
  hint: string
  scopes: ReadonlyArray<Scope>
  createdAt: number
}

export type SeedEnvironmentEntry = EnvironmentSettings & {
  id: string
  name: string
  retentionDays: number
  originAllowlist: ReadonlyArray<string> | null
  keys: SeedKeyEntry[]
}

export type SeedDocument = {
  seedVersion: number
  createdAt: number
  organization: { id: string; name: string }
  project: { id: string; name: string }
  environments: SeedEnvironmentEntry[]
}

export function keyHint(value: string): string {
  const cut = value.lastIndexOf('_') + 1
  const secret = value.slice(cut)
  return `${value.slice(0, cut)}…${secret.slice(-HINT_CHARS)}`
}

export function toDocument(seed: Seed): SeedDocument {
  return {
    seedVersion: SEED_VERSION,
    createdAt: seed.createdAt,
    organization: { ...seed.organization },
    project: { ...seed.project },
    environments: seed.environments.map((environment) => ({
      id: environment.id,
      name: environment.name,
      retentionDays: environment.retentionDays,
      originAllowlist:
        environment.originAllowlist === null ? null : [...environment.originAllowlist],
      minLevel: environment.minLevel,
      sampleRate: environment.sampleRate,
      redaction: environment.redaction,
      keys: environment.keys.map((key) => ({
        id: key.id,
        kind: key.kind,
        hash: key.hash,
        hint: keyHint(key.value),
        scopes: [...key.scopes],
        createdAt: key.createdAt,
      })),
    })),
  }
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new SeedFormatError(`${what} has to be a non-empty string`)
  }
  return value
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new SeedFormatError(`${what} has to be a whole number`)
  }
  return value
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SeedFormatError(`${what} has to be an object`)
  }
  return value as Record<string, unknown>
}

function scopesOf(value: unknown): ReadonlyArray<Scope> {
  if (!Array.isArray(value)) {
    throw new SeedFormatError('scopes has to be a list')
  }
  return value.map((scope) => {
    if (scope !== 'logs:write' && scope !== 'logs:read') {
      throw new SeedFormatError(`"${String(scope)}" is not a scope`)
    }
    return scope
  })
}

function allowlistOf(value: unknown): ReadonlyArray<string> | null {
  if (value === null || value === undefined) {
    return null
  }
  if (!Array.isArray(value)) {
    throw new SeedFormatError('originAllowlist has to be a list or null')
  }
  return value.map((origin) => text(origin, 'an allowed origin'))
}

function keyOf(raw: unknown): SeedKeyEntry {
  const body = object(raw, 'a key')
  const kind = body.kind
  if (kind !== 'public' && kind !== 'secret') {
    throw new SeedFormatError(`"${String(kind)}" is not a key kind`)
  }
  if ('value' in body) {
    throw new SeedFormatError('A seed document must never carry a key in the clear')
  }
  return {
    id: text(body.id, 'a key id'),
    kind,
    hash: text(body.hash, 'a key hash'),
    hint: text(body.hint, 'a key hint'),
    scopes: scopesOf(body.scopes),
    createdAt: count(body.createdAt, 'a key createdAt'),
  }
}

function redactionOf(value: unknown): RedactionRules {
  try {
    return parseRedactionRules(value)
  } catch (error) {
    throw new SeedFormatError(
      `redaction — ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function settingsOf(body: Record<string, unknown>): EnvironmentSettings {
  const minLevel = body.minLevel
  if (minLevel !== undefined) {
    try {
      assertMinLevel(minLevel as string)
    } catch (error) {
      throw new SeedFormatError(error instanceof Error ? error.message : String(error))
    }
  }

  const sampleRate = body.sampleRate
  if (sampleRate !== undefined) {
    try {
      assertSampleRate(sampleRate as number)
    } catch (error) {
      throw new SeedFormatError(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    minLevel: minLevel === undefined ? HISTORICAL_SETTINGS.minLevel : (minLevel as string),
    sampleRate: sampleRate === undefined ? HISTORICAL_SETTINGS.sampleRate : (sampleRate as number),
    redaction:
      body.redaction === undefined ? HISTORICAL_SETTINGS.redaction : redactionOf(body.redaction),
  }
}

function environmentOf(raw: unknown): SeedEnvironmentEntry {
  const body = object(raw, 'an environment')
  const keys = body.keys
  if (!Array.isArray(keys)) {
    throw new SeedFormatError('an environment needs a list of keys')
  }
  return {
    id: text(body.id, 'an environment id'),
    name: text(body.name, 'an environment name'),
    retentionDays: count(body.retentionDays, 'retentionDays'),
    originAllowlist: allowlistOf(body.originAllowlist),
    ...settingsOf(body),
    keys: keys.map(keyOf),
  }
}

export function parseSeedDocument(raw: string): SeedDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SeedFormatError('The seed document is not JSON')
  }

  const body = object(parsed, 'The seed document')
  if (typeof body.seedVersion !== 'number' || !READABLE_SEED_VERSIONS.includes(body.seedVersion)) {
    throw new SeedFormatError(
      `This seed document is version ${String(body.seedVersion)}, and this build reads ${READABLE_SEED_VERSIONS.join(' and ')}`,
    )
  }

  const environments = body.environments
  if (!Array.isArray(environments) || environments.length === 0) {
    throw new SeedFormatError('The seed document needs at least one environment')
  }

  const organization = object(body.organization, 'organization')
  const project = object(body.project, 'project')

  return {
    seedVersion: SEED_VERSION,
    createdAt: count(body.createdAt, 'createdAt'),
    organization: {
      id: text(organization.id, 'the organization id'),
      name: text(organization.name, 'the organization name'),
    },
    project: {
      id: text(project.id, 'the project id'),
      name: text(project.name, 'the project name'),
    },
    environments: environments.map(environmentOf),
  }
}

export function serialiseSeedDocument(document: SeedDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

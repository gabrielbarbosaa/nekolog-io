import { parseRedactionRules, RedactionRuleError } from '@nekolog-io/adapters'
import { retentionCap } from './members.ts'
import { newId } from './signup.ts'
import type { SqlRunner } from './users.ts'

export const PROJECT_ID_PREFIX = 'prj_'
export const ENVIRONMENT_ID_PREFIX = 'env_'

export const MIN_PROJECT_NAME_CHARS = 1
export const MAX_PROJECT_NAME_CHARS = 120

export const ENVIRONMENT_NAME_SHAPE = /^[a-z][a-z0-9-]{0,30}$/

export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
export type Level = (typeof LEVELS)[number]

export const ENVIRONMENT_COLORS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
] as const
export type EnvironmentColor = (typeof ENVIRONMENT_COLORS)[number]

export const STARTING_ENVIRONMENTS: ReadonlyArray<{ name: string; color: EnvironmentColor }> = [
  { name: 'production', color: 'chart-8' },
  { name: 'staging', color: 'chart-4' },
  { name: 'development', color: 'chart-6' },
]

export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 365
export const MAX_ORIGINS = 20
export const MAX_ENVIRONMENTS_PER_PROJECT = 20

const ORIGIN_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/

export const REDACTION_FIELDS = ['attributes', 'patterns', 'replacement'] as const

export function readProjectName(input: string): string | undefined {
  const name = input.trim().replace(/\s+/g, ' ')
  return name.length >= MIN_PROJECT_NAME_CHARS && name.length <= MAX_PROJECT_NAME_CHARS
    ? name
    : undefined
}

export function readEnvironmentName(input: string): string | undefined {
  const name = input.trim().toLowerCase()
  return ENVIRONMENT_NAME_SHAPE.test(name) ? name : undefined
}

export function readOriginPattern(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase().replace(/\/+$/, '')
  if (trimmed === '*') {
    return '*'
  }
  if (!ORIGIN_PATTERN.test(trimmed)) {
    return undefined
  }

  const host = trimmed.slice(trimmed.indexOf('://') + 3).split(':')[0] ?? ''
  if (host.startsWith('*.') && host.slice(2).split('.').filter(Boolean).length < 2) {
    return undefined
  }
  return trimmed
}

export type EnvironmentSettings = {
  color: EnvironmentColor | undefined
  retentionDays: number
  minLevel: Level
  sampleRate: number
  dailyEventQuota: number | undefined
  originAllowlist: readonly string[] | undefined
  redactionRules: Record<string, unknown>
}

export const SETTINGS_REFUSALS = [
  'unknown_color',
  'bad_retention',
  'unknown_level',
  'bad_sample_rate',
  'bad_quota',
  'bad_origins',
  'too_many_origins',
  'bad_redaction_rules',
] as const
export type SettingsRefusal = (typeof SETTINGS_REFUSALS)[number]

export type SettingsRead =
  | { settings: EnvironmentSettings }
  | { refused: SettingsRefusal; field: string; detail?: string }

function isColor(value: unknown): value is EnvironmentColor {
  return typeof value === 'string' && (ENVIRONMENT_COLORS as readonly string[]).includes(value)
}

function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

export function readEnvironmentSettings(body: Record<string, unknown>): SettingsRead {
  const color = body.color
  if (color !== undefined && color !== null && !isColor(color)) {
    return { refused: 'unknown_color', field: 'color' }
  }

  const retentionDays = body.retentionDays
  if (
    typeof retentionDays !== 'number' ||
    !Number.isInteger(retentionDays) ||
    retentionDays < MIN_RETENTION_DAYS ||
    retentionDays > MAX_RETENTION_DAYS
  ) {
    return { refused: 'bad_retention', field: 'retentionDays' }
  }

  const minLevel = body.minLevel
  if (!isLevel(minLevel)) {
    return { refused: 'unknown_level', field: 'minLevel' }
  }

  const sampleRate = body.sampleRate
  if (
    typeof sampleRate !== 'number' ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    sampleRate > 1
  ) {
    return { refused: 'bad_sample_rate', field: 'sampleRate' }
  }

  const quota = body.dailyEventQuota
  if (
    quota !== undefined &&
    quota !== null &&
    (typeof quota !== 'number' || !Number.isInteger(quota) || quota <= 0)
  ) {
    return { refused: 'bad_quota', field: 'dailyEventQuota' }
  }

  const origins = body.originAllowlist
  let allowlist: readonly string[] | undefined
  if (origins !== undefined && origins !== null) {
    if (!Array.isArray(origins)) {
      return { refused: 'bad_origins', field: 'originAllowlist' }
    }
    if (origins.length > MAX_ORIGINS) {
      return { refused: 'too_many_origins', field: 'originAllowlist' }
    }

    const read: string[] = []
    for (const one of origins as unknown[]) {
      const pattern = typeof one === 'string' ? readOriginPattern(one) : undefined
      if (pattern === undefined) {
        return { refused: 'bad_origins', field: 'originAllowlist', detail: String(one) }
      }
      if (!read.includes(pattern)) {
        read.push(pattern)
      }
    }
    allowlist = read
  }

  const rules = body.redactionRules
  let redactionRules: Record<string, unknown> = {}
  if (rules !== undefined && rules !== null) {
    if (typeof rules === 'object' && !Array.isArray(rules)) {
      const unknown = Object.keys(rules).find(
        (key) => !(REDACTION_FIELDS as readonly string[]).includes(key),
      )
      if (unknown !== undefined) {
        return { refused: 'bad_redaction_rules', field: unknown }
      }
    }
    try {
      const parsed = parseRedactionRules(rules)
      redactionRules = {
        attributes: [...parsed.attributes],
        patterns: [...parsed.patterns],
        replacement: parsed.replacement,
      }
    } catch (error) {
      return {
        refused: 'bad_redaction_rules',
        field: error instanceof RedactionRuleError ? error.field : 'redactionRules',
      }
    }
  }

  return {
    settings: {
      color: isColor(color) ? color : undefined,
      retentionDays,
      minLevel,
      sampleRate,
      dailyEventQuota: typeof quota === 'number' ? quota : undefined,
      originAllowlist: allowlist,
      redactionRules,
    },
  }
}

const CREATE_PROJECT = `
  with project as (
    insert into projects (id, organization_id, name)
    select $1, $2, $3
    where exists (select 1 from organizations where id = $2)
    returning id
  )
  insert into environments (id, project_id, name, color)
  select starting.id, project.id, starting.name, starting.color
  from project, unnest($4::text[], $5::text[], $6::text[]) as starting(id, name, color)
  returning project_id as id, environments.id as environment_id, environments.name
`

const LIST_PROJECTS = `
  select projects.id, projects.name, projects.created_at,
         count(environments.id) as environments
  from projects
  left join environments on environments.project_id = projects.id
  where projects.organization_id = $1
  group by projects.id
  order by projects.name, projects.id
`

const ONE_PROJECT = `
  select id, name, created_at from projects
  where organization_id = $1 and id = $2
  limit 1
`

const RENAME_PROJECT = `
  update projects set name = $3
  where organization_id = $1 and id = $2
  returning id, name
`

const DELETE_PROJECT = `
  delete from projects where organization_id = $1 and id = $2 returning id, name
`

const BELONGS_TO = `exists (
      select 1 from projects
      where projects.id = environments.project_id
        and projects.id = $2 and projects.organization_id = $1
    )`

const LIST_ENVIRONMENTS = `
  select environments.id, environments.name, environments.color,
         environments.retention_days, environments.min_level, environments.sample_rate,
         environments.daily_event_quota, environments.origin_allowlist,
         environments.redaction_rules, environments.created_at,
         count(api_keys.id) filter (where api_keys.revoked_at is null) as live_keys
  from environments
  left join api_keys on api_keys.environment_id = environments.id
  where ${BELONGS_TO}
  group by environments.id
  order by environments.name, environments.id
`

const CREATE_ENVIRONMENT = `
  insert into environments (id, project_id, name, color)
  select $3, $2, $4, $5
  where exists (select 1 from projects where id = $2 and organization_id = $1)
    and (
      select count(*) from environments where project_id = $2
    ) < $6::int
  returning id, name, color
`

const UPDATE_ENVIRONMENT = `
  update environments set
    color = $4,
    retention_days = $5,
    min_level = $6,
    sample_rate = $7,
    daily_event_quota = $8,
    origin_allowlist = $9::text[],
    redaction_rules = $10::text::jsonb
  where environments.id = $3 and ${BELONGS_TO}
    and $5::int <= (select max_retention_days from organizations where organizations.id = $1)
  returning environments.id, environments.name
`

const ONE_ENVIRONMENT = `
  select environments.id, environments.name, environments.color,
         environments.retention_days, environments.min_level, environments.sample_rate,
         environments.daily_event_quota, environments.origin_allowlist,
         environments.redaction_rules, environments.created_at
  from environments
  where environments.id = $3 and ${BELONGS_TO}
  limit 1
`

const SOMETHING_ELSE_IS_LEFT = `exists (
      select 1 from environments others
      where others.project_id = $2 and others.id <> $3
    )`

const DELETE_ENVIRONMENT = `
  delete from environments
  where environments.id = $3 and ${BELONGS_TO} and ${SOMETHING_ELSE_IS_LEFT}
  returning environments.id, environments.name
`

export type Project = {
  id: string
  name: string
  environments: number
  createdAt: Date
}

export type Environment = {
  id: string
  name: string
  color: EnvironmentColor | undefined
  retentionDays: number
  minLevel: Level
  sampleRate: number
  dailyEventQuota: number | undefined
  originAllowlist: readonly string[] | undefined
  redactionRules: unknown
  liveKeys: number
  createdAt: Date
}

function dateOf(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function levelOf(value: unknown): Level {
  const level = String(value)
  if (!isLevel(level)) {
    throw new Error(`the database holds a level this code does not know: ${level}`)
  }
  return level
}

function environmentOf(row: Record<string, unknown>): Environment {
  return {
    id: String(row.id),
    name: String(row.name),
    color: isColor(row.color) ? row.color : undefined,
    retentionDays: Number(row.retention_days),
    minLevel: levelOf(row.min_level),
    sampleRate: Number(row.sample_rate),
    dailyEventQuota: row.daily_event_quota === null ? undefined : Number(row.daily_event_quota),
    originAllowlist: Array.isArray(row.origin_allowlist)
      ? (row.origin_allowlist as string[]).map(String)
      : undefined,
    redactionRules: row.redaction_rules ?? {},
    liveKeys: Number(row.live_keys ?? 0),
    createdAt: dateOf(row.created_at),
  }
}

export type ProjectCreated =
  | {
      outcome: 'created'
      projectId: string
      environments: ReadonlyArray<{ id: string; name: string }>
    }
  | { outcome: 'bad-name' }
  | { outcome: 'no-such-organization' }

export async function createProject(
  run: SqlRunner,
  input: { organizationId: string; name: string },
): Promise<ProjectCreated> {
  const name = readProjectName(input.name)
  if (name === undefined) {
    return { outcome: 'bad-name' }
  }

  const projectId = newId(PROJECT_ID_PREFIX)
  const rows = await run(CREATE_PROJECT, [
    projectId,
    input.organizationId,
    name,
    STARTING_ENVIRONMENTS.map(() => newId(ENVIRONMENT_ID_PREFIX)),
    STARTING_ENVIRONMENTS.map((one) => one.name),
    STARTING_ENVIRONMENTS.map((one) => one.color),
  ])

  if (rows.length === 0) {
    return { outcome: 'no-such-organization' }
  }

  return {
    outcome: 'created',
    projectId,
    environments: rows.map((row) => ({
      id: String(row.environment_id),
      name: String(row.name),
    })),
  }
}

export async function listProjects(run: SqlRunner, organizationId: string): Promise<Project[]> {
  const rows = await run(LIST_PROJECTS, [organizationId])
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    environments: Number(row.environments),
    createdAt: dateOf(row.created_at),
  }))
}

export async function findProject(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
): Promise<{ id: string; name: string; createdAt: Date } | undefined> {
  const rows = await run(ONE_PROJECT, [organizationId, projectId])
  const row = rows[0]
  return row === undefined
    ? undefined
    : { id: String(row.id), name: String(row.name), createdAt: dateOf(row.created_at) }
}

export async function renameProject(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
  name: string,
): Promise<string | undefined> {
  const wanted = readProjectName(name)
  if (wanted === undefined) {
    return undefined
  }

  const rows = await run(RENAME_PROJECT, [organizationId, projectId, wanted])
  const row = rows[0]
  return row === undefined ? undefined : String(row.name)
}

export async function deleteProject(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
): Promise<string | undefined> {
  const rows = await run(DELETE_PROJECT, [organizationId, projectId])
  const row = rows[0]
  return row === undefined ? undefined : String(row.name)
}

export async function listEnvironments(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
): Promise<Environment[]> {
  const rows = await run(LIST_ENVIRONMENTS, [organizationId, projectId])
  return rows.map(environmentOf)
}

export async function findEnvironment(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
  environmentId: string,
): Promise<Environment | undefined> {
  const rows = await run(ONE_ENVIRONMENT, [organizationId, projectId, environmentId])
  const row = rows[0]
  return row === undefined ? undefined : environmentOf(row)
}

export type EnvironmentCreated =
  | { outcome: 'created'; environmentId: string; name: string }
  | { outcome: 'bad-name' }
  | { outcome: 'unknown-color' }
  | { outcome: 'name-taken' }
  | { outcome: 'too-many' }

const UNIQUE_VIOLATION = '23505'

function isDuplicate(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  )
}

export async function createEnvironment(
  run: SqlRunner,
  input: { organizationId: string; projectId: string; name: string; color?: string | undefined },
): Promise<EnvironmentCreated> {
  const name = readEnvironmentName(input.name)
  if (name === undefined) {
    return { outcome: 'bad-name' }
  }
  if (input.color !== undefined && !isColor(input.color)) {
    return { outcome: 'unknown-color' }
  }

  const environmentId = newId(ENVIRONMENT_ID_PREFIX)
  let rows: ReadonlyArray<Record<string, unknown>>
  try {
    rows = await run(CREATE_ENVIRONMENT, [
      input.organizationId,
      input.projectId,
      environmentId,
      name,
      input.color ?? null,
      MAX_ENVIRONMENTS_PER_PROJECT,
    ])
  } catch (error) {
    if (isDuplicate(error)) {
      return { outcome: 'name-taken' }
    }
    throw error
  }

  const row = rows[0]
  return row === undefined
    ? { outcome: 'too-many' }
    : { outcome: 'created', environmentId: String(row.id), name: String(row.name) }
}

export type EnvironmentWritten =
  | { outcome: 'written'; name: string }
  | { outcome: 'over-the-cap'; cap: number }
  | { outcome: 'no-such-environment' }

export async function updateEnvironment(
  run: SqlRunner,
  input: {
    organizationId: string
    projectId: string
    environmentId: string
    settings: EnvironmentSettings
  },
): Promise<EnvironmentWritten> {
  const { settings } = input

  const rows = await run(UPDATE_ENVIRONMENT, [
    input.organizationId,
    input.projectId,
    input.environmentId,
    settings.color ?? null,
    settings.retentionDays,
    settings.minLevel,
    settings.sampleRate,
    settings.dailyEventQuota ?? null,
    settings.originAllowlist === undefined ? null : [...settings.originAllowlist],
    JSON.stringify(settings.redactionRules),
  ])

  const row = rows[0]
  if (row !== undefined) {
    return { outcome: 'written', name: String(row.name) }
  }

  const theirs = await findEnvironment(
    run,
    input.organizationId,
    input.projectId,
    input.environmentId,
  )
  if (theirs === undefined) {
    return { outcome: 'no-such-environment' }
  }

  const cap = (await retentionCap(run, input.organizationId)) ?? MAX_RETENTION_DAYS
  return settings.retentionDays > cap
    ? { outcome: 'over-the-cap', cap }
    : { outcome: 'no-such-environment' }
}

export type EnvironmentRemoved =
  | { outcome: 'deleted'; name: string }
  | { outcome: 'the-last-environment' }

export async function deleteEnvironment(
  run: SqlRunner,
  organizationId: string,
  projectId: string,
  environmentId: string,
): Promise<EnvironmentRemoved> {
  const rows = await run(DELETE_ENVIRONMENT, [organizationId, projectId, environmentId])
  const row = rows[0]
  return row === undefined
    ? { outcome: 'the-last-environment' }
    : { outcome: 'deleted', name: String(row.name) }
}

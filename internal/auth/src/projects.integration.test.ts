import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrganization } from './members.ts'
import { setQuota } from './operator.ts'
import {
  createEnvironment,
  createProject,
  deleteEnvironment,
  deleteProject,
  findEnvironment,
  findProject,
  listEnvironments,
  listProjects,
  MAX_ENVIRONMENTS_PER_PROJECT,
  readEnvironmentSettings,
  renameProject,
  STARTING_ENVIRONMENTS,
  updateEnvironment,
} from './projects.ts'
import { newId, USER_ID_PREFIX } from './signup.ts'
import type { SqlRunner } from './users.ts'

const URL = process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'

async function answers(): Promise<boolean> {
  const probe = postgres(URL, { max: 1, connect_timeout: 2, onnotice: () => {} })
  try {
    await probe.unsafe('select 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end({ timeout: 1 })
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.POSTGRES_TEST_REQUIRED === '1') {
    throw new Error(
      `POSTGRES_TEST_REQUIRED is set but nothing answered at ${URL}. These tests must not be skipped here.`,
    )
  }
  process.stderr.write(
    `\nSkipping the project integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
)

const DATABASE = `nekolog_projects_${process.pid}`

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

let sql: ReturnType<typeof postgres>
let run: SqlRunner

async function countOf(text: string, params: unknown[] = []): Promise<number> {
  const rows = (await sql.unsafe(text, params as never[])) as unknown as Array<{ n: number }>
  return rows[0]?.n ?? -1
}

async function anOwner(): Promise<string> {
  const id = newId(USER_ID_PREFIX)
  await sql.unsafe(
    `insert into users (id, name, email, password_hash, email_verified_at)
     values ($1, $2, $3, '$argon2id$v=19$m=19456,t=2,p=1$abc$def', now())`,
    [id, 'An Owner', `owner-${randomBytes(5).toString('hex')}@acme.test`],
  )
  return id
}

async function anOrganization(): Promise<string> {
  const id = await createOrganization(run, {
    name: `Acme ${randomBytes(3).toString('hex')}`,
    ownerUserId: await anOwner(),
  })
  if (id === undefined) {
    throw new Error('the organization was not created')
  }
  return id
}

async function aProject(organizationId: string): Promise<string> {
  const created = await createProject(run, { organizationId, name: 'The Shop' })
  if (created.outcome !== 'created') {
    throw new Error(`the project was not created: ${created.outcome}`)
  }
  return created.projectId
}

function settings(patch: Record<string, unknown> = {}): ReturnType<typeof readEnvironmentSettings> {
  return readEnvironmentSettings({
    retentionDays: 7,
    minLevel: 'trace',
    sampleRate: 1,
    ...patch,
  })
}

function sound(patch: Record<string, unknown> = {}) {
  const read = settings(patch)
  if ('refused' in read) {
    throw new Error(`refused ${read.refused}`)
  }
  return read.settings
}

beforeAll(async () => {
  if (!reachable) {
    return
  }

  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`create database "${DATABASE}"`)
  } finally {
    await admin.end()
  }

  sql = postgres(URL.replace(/\/[^/]*$/, `/${DATABASE}`), { max: 2, onnotice: () => {} })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }

  run = async (text, params) =>
    (await sql.unsafe(text, params as never[])) as unknown as ReadonlyArray<Record<string, unknown>>
}, 60_000)

afterAll(async () => {
  if (!reachable) {
    return
  }

  await sql?.end()
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`)
  } finally {
    await admin.end()
  }
})

describe.runIf(reachable)('a project being born', () => {
  it('arrives with the three environments the plan names, in one statement', async () => {
    const organizationId = await anOrganization()
    const created = await createProject(run, { organizationId, name: '  The   Shop ' })

    expect(created.outcome).toBe('created')
    if (created.outcome !== 'created') {
      return
    }

    expect(created.environments.map((one) => one.name).sort()).toEqual(
      STARTING_ENVIRONMENTS.map((one) => one.name).sort(),
    )

    const stored = await listEnvironments(run, organizationId, created.projectId)
    expect(stored.map((one) => one.name)).toEqual(['development', 'production', 'staging'])
    expect(stored.every((one) => one.color !== undefined)).toBe(true)
    expect((await findProject(run, organizationId, created.projectId))?.name).toBe('The Shop')
  })

  it('leaves nothing behind when the organization is not there', async () => {
    const before = await countOf('select count(*)::int as n from projects')

    expect(
      (await createProject(run, { organizationId: newId('org_'), name: 'Ghost' })).outcome,
    ).toBe('no-such-organization')

    expect(await countOf('select count(*)::int as n from projects')).toBe(before)
  })

  it('refuses a blank name before it touches the database', async () => {
    expect((await createProject(run, { organizationId: newId('org_'), name: '   ' })).outcome).toBe(
      'bad-name',
    )
  })
})

describe.runIf(reachable)('a project belonging to somebody else', () => {
  it('is invisible, unreadable, unrenamable and undeletable from the other organization', async () => {
    const mine = await anOrganization()
    const theirs = await anOrganization()
    const project = await aProject(theirs)

    expect((await listProjects(run, mine)).map((one) => one.id)).not.toContain(project)
    expect(await findProject(run, mine, project)).toBeUndefined()
    expect(await renameProject(run, mine, project, 'Mine Now')).toBeUndefined()
    expect(await deleteProject(run, mine, project)).toBeUndefined()
    expect(await listEnvironments(run, mine, project)).toEqual([])
    expect(await findProject(run, theirs, project)).toBeDefined()
  })

  it('keeps its environments out of reach too', async () => {
    const mine = await anOrganization()
    const theirs = await anOrganization()
    const project = await aProject(theirs)
    const environment = (await listEnvironments(run, theirs, project))[0]
    if (environment === undefined) {
      throw new Error('no environment')
    }

    expect(await findEnvironment(run, mine, project, environment.id)).toBeUndefined()
    expect(
      (
        await updateEnvironment(run, {
          organizationId: mine,
          projectId: project,
          environmentId: environment.id,
          settings: sound({ retentionDays: 3 }),
        })
      ).outcome,
      'the retention is within every cap, so this can only be refused for whose it is',
    ).toBe('no-such-environment')
    expect((await deleteEnvironment(run, mine, project, environment.id)).outcome).toBe(
      'the-last-environment',
    )

    const after = await findEnvironment(run, theirs, project, environment.id)
    expect(after?.retentionDays, 'the settings of the other tenant must not have moved').toBe(7)
  })

  it('cannot be reached through another project of my own', async () => {
    const mine = await anOrganization()
    const theirs = await anOrganization()
    const myProject = await aProject(mine)
    const theirProject = await aProject(theirs)
    const theirEnvironment = (await listEnvironments(run, theirs, theirProject))[0]
    if (theirEnvironment === undefined) {
      throw new Error('no environment')
    }

    expect(await findEnvironment(run, mine, myProject, theirEnvironment.id)).toBeUndefined()
    expect((await deleteEnvironment(run, mine, myProject, theirEnvironment.id)).outcome).toBe(
      'the-last-environment',
    )
    expect(await findEnvironment(run, theirs, theirProject, theirEnvironment.id)).toBeDefined()
  })
})

describe.runIf(reachable)('the settings of an environment', () => {
  it('goes to the database and comes back as it was written', async () => {
    const organizationId = await anOrganization()
    const project = await aProject(organizationId)
    const production = (await listEnvironments(run, organizationId, project)).find(
      (one) => one.name === 'production',
    )
    if (production === undefined) {
      throw new Error('no production')
    }

    await setQuota(run, organizationId, { dailyEventQuota: 500_000, maxRetentionDays: 30 })

    expect(
      (
        await updateEnvironment(run, {
          organizationId,
          projectId: project,
          environmentId: production.id,
          settings: sound({
            color: 'chart-2',
            retentionDays: 30,
            minLevel: 'warn',
            sampleRate: 0.25,
            dailyEventQuota: 50_000,
            originAllowlist: ['https://shop.test', 'https://*.shop.test'],
            redactionRules: { patterns: ['cpf', 'email'], attributes: ['user.*'] },
          }),
        })
      ).outcome,
    ).toBe('written')

    const back = await findEnvironment(run, organizationId, project, production.id)

    expect(back).toMatchObject({
      color: 'chart-2',
      retentionDays: 30,
      minLevel: 'warn',
      sampleRate: 0.25,
      dailyEventQuota: 50_000,
      originAllowlist: ['https://shop.test', 'https://*.shop.test'],
    })
    expect(
      back?.redactionRules,
      'the rules must come back as an object, not as a string of JSON',
    ).toEqual({
      attributes: ['user.*'],
      patterns: ['cpf', 'email'],
      replacement: '[redacted]',
    })
  })

  it('clears the allowlist and the quota when they are taken away', async () => {
    const organizationId = await anOrganization()
    const project = await aProject(organizationId)
    const staging = (await listEnvironments(run, organizationId, project)).find(
      (one) => one.name === 'staging',
    )
    if (staging === undefined) {
      throw new Error('no staging')
    }

    await updateEnvironment(run, {
      organizationId,
      projectId: project,
      environmentId: staging.id,
      settings: sound({ dailyEventQuota: 10, originAllowlist: ['https://a.test'] }),
    })
    await updateEnvironment(run, {
      organizationId,
      projectId: project,
      environmentId: staging.id,
      settings: sound(),
    })

    const back = await findEnvironment(run, organizationId, project, staging.id)
    expect(back?.dailyEventQuota).toBeUndefined()
    expect(back?.originAllowlist, 'no allowlist is not an empty allowlist').toBeUndefined()
  })

  it('is refused by the schema too, not only by the reader', async () => {
    const organizationId = await anOrganization()
    const project = await aProject(organizationId)
    const environment = (await listEnvironments(run, organizationId, project))[0] as {
      id: string
    }

    await expect(
      sql.unsafe('update environments set sample_rate = 0 where id = $1', [environment.id]),
    ).rejects.toThrow(/environments_sample_rate_is_a_share/)
    await expect(
      sql.unsafe("update environments set min_level = 'verbose' where id = $1", [environment.id]),
    ).rejects.toThrow(/environments_min_level_is_a_level/)
  })
})

describe.runIf(reachable)('adding and removing an environment', () => {
  it('adds one and refuses the same name twice', async () => {
    const organizationId = await anOrganization()
    const project = await aProject(organizationId)

    expect(
      (await createEnvironment(run, { organizationId, projectId: project, name: 'QA' })).outcome,
    ).toBe('created')
    expect(
      (await createEnvironment(run, { organizationId, projectId: project, name: 'qa' })).outcome,
    ).toBe('name-taken')
    expect((await listEnvironments(run, organizationId, project)).map((one) => one.name)).toContain(
      'qa',
    )
  })

  it('refuses one on a project of another organization, in the statement itself', async () => {
    const mine = await anOrganization()
    const theirs = await anOrganization()
    const project = await aProject(theirs)

    expect(
      (await createEnvironment(run, { organizationId: mine, projectId: project, name: 'qa' }))
        .outcome,
    ).toBe('too-many')
    expect((await listEnvironments(run, theirs, project)).map((one) => one.name)).not.toContain(
      'qa',
    )
  })

  it('stops at the ceiling instead of letting a project grow without end', async () => {
    const organizationId = await anOrganization()
    const project = await aProject(organizationId)

    for (let n = STARTING_ENVIRONMENTS.length; n < MAX_ENVIRONMENTS_PER_PROJECT; n += 1) {
      expect(
        (await createEnvironment(run, { organizationId, projectId: project, name: `env-${n}` }))
          .outcome,
      ).toBe('created')
    }

    expect(
      (await createEnvironment(run, { organizationId, projectId: project, name: 'one-too-many' }))
        .outcome,
    ).toBe('too-many')
    expect(await listEnvironments(run, organizationId, project)).toHaveLength(
      MAX_ENVIRONMENTS_PER_PROJECT,
    )
  })

  it('never leaves a project with no environment at all', async () => {
    const organizationId = await anOrganization()
    const project = await aProject(organizationId)
    const all = await listEnvironments(run, organizationId, project)

    for (const one of all.slice(0, -1)) {
      expect((await deleteEnvironment(run, organizationId, project, one.id)).outcome).toBe(
        'deleted',
      )
    }

    const last = all.at(-1) as { id: string }
    expect((await deleteEnvironment(run, organizationId, project, last.id)).outcome).toBe(
      'the-last-environment',
    )
    expect(await listEnvironments(run, organizationId, project)).toHaveLength(1)
  })

  it('takes the keys of an environment with it, and the environments of a project', async () => {
    const organizationId = await anOrganization()
    const project = await aProject(organizationId)
    const environment = (await listEnvironments(run, organizationId, project))[0] as { id: string }

    await sql.unsafe(
      `insert into api_keys (id, environment_id, kind, hash, hint, scopes)
       values ($1, $2, 'public', $3, 'pk_…abcd', array['logs:write'])`,
      [newId('key_'), environment.id, randomBytes(32).toString('hex')],
    )

    expect((await listEnvironments(run, organizationId, project))[0]?.liveKeys).toBe(1)
    expect(await deleteProject(run, organizationId, project)).toBe('The Shop')

    expect(
      await countOf('select count(*)::int as n from environments where project_id = $1', [project]),
    ).toBe(0)
    expect(
      await countOf('select count(*)::int as n from api_keys where environment_id = $1', [
        environment.id,
      ]),
    ).toBe(0)
  })
})

describe.runIf(reachable)('the list a screen reads', () => {
  it('counts the environments of each project without a second query', async () => {
    const organizationId = await anOrganization()
    const first = await aProject(organizationId)
    await createEnvironment(run, { organizationId, projectId: first, name: 'qa' })
    await createProject(run, { organizationId, name: 'Another' })

    const listed = await listProjects(run, organizationId)

    expect(listed).toHaveLength(2)
    expect(listed.find((one) => one.id === first)?.environments).toBe(
      STARTING_ENVIRONMENTS.length + 1,
    )
    expect(listed.find((one) => one.name === 'Another')?.environments).toBe(
      STARTING_ENVIRONMENTS.length,
    )
  })
})

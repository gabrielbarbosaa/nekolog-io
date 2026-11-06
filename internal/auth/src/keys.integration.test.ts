import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hashApiKey,
  PUBLIC_KEY_PREFIX,
  parseApiKey,
  publishKeys,
  SECRET_KEY_PREFIX,
  sqlKeyDirectory,
} from '@nekolog-io/adapters'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  findKey,
  listKeys,
  MAX_LIVE_KEYS_PER_ENVIRONMENT,
  mintKey,
  revokeKey,
  rotateKey,
} from './keys.ts'
import { createOrganization } from './members.ts'
import { createProject, listEnvironments } from './projects.ts'
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
    `\nSkipping the API key integration tests: nothing answered at ${URL}.\n` +
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

const DATABASE = `nekolog_keys_${process.pid}`

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

async function anOrganization(): Promise<string> {
  const userId = newId(USER_ID_PREFIX)
  await sql.unsafe(
    `insert into users (id, name, email, password_hash, email_verified_at)
     values ($1, 'An Owner', $2, '$argon2id$v=19$m=19456,t=2,p=1$abc$def', now())`,
    [userId, `keys-${randomBytes(5).toString('hex')}@acme.test`],
  )
  const id = await createOrganization(run, {
    name: `Acme ${randomBytes(3).toString('hex')}`,
    ownerUserId: userId,
  })
  if (id === undefined) {
    throw new Error('the organization was not created')
  }
  return id
}

async function aProject(organizationId: string): Promise<{ project: string; environment: string }> {
  const created = await createProject(run, { organizationId, name: 'The Shop' })
  if (created.outcome !== 'created') {
    throw new Error('the project was not created')
  }
  const environments = await listEnvironments(run, organizationId, created.projectId)
  const production = environments.find((one) => one.name === 'production')
  if (production === undefined) {
    throw new Error('no production')
  }
  return { project: created.projectId, environment: production.id }
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

describe.runIf(reachable)('minting a key', () => {
  it('shows the key once and stores only its hash', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)

    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'public',
    })
    expect(minted.outcome).toBe('minted')
    if (minted.outcome !== 'minted') {
      return
    }

    expect(parseApiKey(minted.value)?.kind).toBe('public')
    expect(minted.value.startsWith(PUBLIC_KEY_PREFIX)).toBe(true)

    const rows = (await sql.unsafe('select hash, hint, scopes from api_keys where id = $1', [
      minted.keyId,
    ])) as unknown as Array<{ hash: string; hint: string; scopes: string[] }>
    const row = rows[0] as { hash: string; hint: string; scopes: string[] }

    expect(row.hash).toBe(await hashApiKey(minted.value))
    expect(row.hash).not.toContain(minted.value.slice(PUBLIC_KEY_PREFIX.length))
    expect(row.hint).toBe(`${PUBLIC_KEY_PREFIX}…${minted.value.slice(-4)}`)
    expect(row.scopes).toEqual(['logs:write'])

    const listed = await listKeys(run, organizationId, project)
    expect(listed.map((one) => one.id)).toContain(minted.keyId)
    expect(
      JSON.stringify(listed),
      'the list a screen reads must never carry the key itself',
    ).not.toContain(minted.value)
  })

  it('mints a secret key that may read as well as write', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)

    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'secret',
      scopes: ['logs:read', 'logs:write'],
    })

    expect(minted.outcome).toBe('minted')
    if (minted.outcome !== 'minted') {
      return
    }
    expect(minted.value.startsWith(SECRET_KEY_PREFIX)).toBe(true)

    const listed = await listKeys(run, organizationId, project)
    expect([...(listed.find((one) => one.id === minted.keyId)?.scopes ?? [])].sort()).toEqual([
      'logs:read',
      'logs:write',
    ])
  })

  it('refuses to give a public key anything but logs:write', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)

    expect(
      (
        await mintKey(run, {
          organizationId,
          projectId: project,
          environmentId: environment,
          kind: 'public',
          scopes: ['logs:read'],
        })
      ).outcome,
    ).toBe('bad-scopes')
  })

  it('refuses a scope nobody declared', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)

    expect(
      (
        await mintKey(run, {
          organizationId,
          projectId: project,
          environmentId: environment,
          kind: 'secret',
          scopes: ['logs:delete'],
        })
      ).outcome,
    ).toBe('bad-scopes')
  })

  it('stops at the ceiling of live keys for one environment', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)

    for (let n = 0; n < MAX_LIVE_KEYS_PER_ENVIRONMENT; n += 1) {
      expect(
        (
          await mintKey(run, {
            organizationId,
            projectId: project,
            environmentId: environment,
            kind: 'secret',
          })
        ).outcome,
      ).toBe('minted')
    }

    expect(
      (
        await mintKey(run, {
          organizationId,
          projectId: project,
          environmentId: environment,
          kind: 'secret',
        })
      ).outcome,
    ).toBe('too-many')
  })
})

describe.runIf(reachable)('a key of another organization', () => {
  it('cannot be minted, listed, found, revoked or rotated from here', async () => {
    const mine = await anOrganization()
    const theirs = await anOrganization()
    const myPlace = await aProject(mine)
    const theirPlace = await aProject(theirs)

    const minted = await mintKey(run, {
      organizationId: theirs,
      projectId: theirPlace.project,
      environmentId: theirPlace.environment,
      kind: 'secret',
    })
    if (minted.outcome !== 'minted') {
      throw new Error('the key was not minted')
    }

    expect(
      (
        await mintKey(run, {
          organizationId: mine,
          projectId: theirPlace.project,
          environmentId: theirPlace.environment,
          kind: 'secret',
        })
      ).outcome,
    ).toBe('too-many')
    expect(await listKeys(run, mine, theirPlace.project)).toEqual([])
    expect(await findKey(run, mine, theirPlace.project, minted.keyId)).toBeUndefined()
    expect(await revokeKey(run, mine, theirPlace.project, minted.keyId)).toBeUndefined()
    expect((await rotateKey(run, mine, theirPlace.project, minted.keyId)).outcome).toBe(
      'no-such-key',
    )

    expect(
      await findKey(run, mine, myPlace.project, minted.keyId),
      'naming my own project must not reach their key either',
    ).toBeUndefined()
    expect((await rotateKey(run, mine, myPlace.project, minted.keyId)).outcome).toBe('no-such-key')

    expect((await findKey(run, theirs, theirPlace.project, minted.keyId))?.revoked).toBe(false)
  })
})

describe.runIf(reachable)('revoking and rotating', () => {
  it('revokes once and says nothing the second time', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)
    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'secret',
    })
    if (minted.outcome !== 'minted') {
      throw new Error('the key was not minted')
    }

    expect((await revokeKey(run, organizationId, project, minted.keyId))?.hint).toBe(minted.hint)
    expect(await revokeKey(run, organizationId, project, minted.keyId)).toBeUndefined()
    expect((await findKey(run, organizationId, project, minted.keyId))?.revoked).toBe(true)
  })

  it('rotates into a new key with the same kind and scopes, and retires the old one', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)
    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'secret',
      scopes: ['logs:read'],
    })
    if (minted.outcome !== 'minted') {
      throw new Error('the key was not minted')
    }

    const rotated = await rotateKey(run, organizationId, project, minted.keyId)
    expect(rotated.outcome).toBe('rotated')
    if (rotated.outcome !== 'rotated') {
      return
    }

    expect(rotated.keyId).not.toBe(minted.keyId)
    expect(rotated.value).not.toBe(minted.value)
    expect(rotated.environmentId).toBe(environment)

    const listed = await listKeys(run, organizationId, project)
    const old = listed.find((one) => one.id === minted.keyId)
    const fresh = listed.find((one) => one.id === rotated.keyId)

    expect(old?.revokedAt).toBeDefined()
    expect(fresh?.revokedAt).toBeUndefined()
    expect(fresh?.kind).toBe('secret')
    expect(fresh?.scopes).toEqual(['logs:read'])
  })

  it('refuses to rotate a key that is already revoked', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)
    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'secret',
    })
    if (minted.outcome !== 'minted') {
      throw new Error('the key was not minted')
    }

    await revokeKey(run, organizationId, project, minted.keyId)

    expect((await rotateKey(run, organizationId, project, minted.keyId)).outcome).toBe(
      'no-such-key',
    )
  })
})

describe.runIf(reachable)('what the jobs publish to the KV', () => {
  it('carries the environment settings, so a change on the screen reaches the ingestion', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)
    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'public',
    })
    if (minted.outcome !== 'minted') {
      throw new Error('the key was not minted')
    }

    await sql.unsafe(
      `update environments set retention_days = 30, min_level = 'warn', sample_rate = 0.25,
         origin_allowlist = array['https://shop.test'],
         redaction_rules = '{"patterns":["email"]}'::jsonb
       where id = $1`,
      [environment],
    )

    const live = await sqlKeyDirectory(run).live()
    const published = live.find((one) => one.record.keyId === minted.keyId)

    expect(published?.keyHash).toBe(await hashApiKey(minted.value))
    expect(published?.record).toMatchObject({
      projectId: project,
      environmentId: environment,
      retentionDays: 30,
      minLevel: 'warn',
      sampleRate: 0.25,
      originAllowlist: ['https://shop.test'],
      scopes: ['logs:write'],
      blocked: false,
    })
    expect(published?.record.redaction).toEqual({ patterns: ['email'] })
  })

  it('leaves out a key that was revoked, which is what a revocation reaches the KV as', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)
    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'secret',
    })
    if (minted.outcome !== 'minted') {
      throw new Error('the key was not minted')
    }

    const store = new Map<string, string>()
    const namespace = {
      async get(key: string) {
        return store.get(key) ?? null
      },
      async put(key: string, value: string) {
        store.set(key, value)
      },
      async delete(key: string) {
        store.delete(key)
      },
    }
    const directory = sqlKeyDirectory(run)

    await publishKeys(namespace, await directory.live())
    const before = store.size

    await revokeKey(run, organizationId, project, minted.keyId)
    const after = await publishKeys(namespace, await directory.live())

    expect(after.removed).toBe(1)
    expect(store.size).toBe(before - 1)
  })

  it('stamps the last use forward and never backward', async () => {
    const organizationId = await anOrganization()
    const { project, environment } = await aProject(organizationId)
    const minted = await mintKey(run, {
      organizationId,
      projectId: project,
      environmentId: environment,
      kind: 'secret',
    })
    if (minted.outcome !== 'minted') {
      throw new Error('the key was not minted')
    }

    const directory = sqlKeyDirectory(run)
    const later = new Date('2026-11-06T12:00:00.000Z')
    const earlier = new Date('2026-11-01T12:00:00.000Z')

    expect(await directory.stampLastUsed([{ keyId: minted.keyId, at: later }])).toBe(1)
    expect(
      await directory.stampLastUsed([{ keyId: minted.keyId, at: earlier }]),
      'a late batch must not move the last use backwards',
    ).toBe(0)

    const listed = await listKeys(run, organizationId, project)
    expect(listed.find((one) => one.id === minted.keyId)?.lastUsedAt?.toISOString()).toBe(
      later.toISOString(),
    )
  })

  it('stamps nothing for a key id that is not there', async () => {
    expect(
      await sqlKeyDirectory(run).stampLastUsed([{ keyId: newId('key_'), at: new Date() }]),
    ).toBe(0)
    expect(await sqlKeyDirectory(run).stampLastUsed([])).toBe(0)
  })
})

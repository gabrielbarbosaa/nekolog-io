import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSeed,
  keyStoreFromDocument,
  type Seed,
  type SeedDocument,
  seedStatements,
  toDocument,
} from '@internal/seed'
import { fileBlobStore } from '@internal/self-host'
import {
  blobSourceMapStore,
  type IssueOccurrence,
  sqlIssueReader,
  sqlIssueStore,
  sqlReleaseStore,
} from '@nekolog-io/adapters'
import { type ClickHouseConfig, execute, migrate, ping, queryRows } from '@nekolog-io/clickhouse'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp } from '../src/app.ts'
import { createReadAuthenticator, createWriteAuthenticator } from '../src/authenticate.ts'
import { openApiDocument } from '../src/openapi.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const base: Omit<ClickHouseConfig, 'database'> = {
  url: process.env.CLICKHOUSE_TEST_URL ?? 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD ?? 'nekolog',
}

const POSTGRES_URL =
  process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'

const database = `nekolog_api_${process.pid}`
const config: ClickHouseConfig = { ...base, database }
const POSTGRES_DATABASE = `nekolog_api_${process.pid}`

async function postgresAnswers(): Promise<boolean> {
  const admin = postgres(POSTGRES_URL, {
    max: 1,
    idle_timeout: 1,
    connect_timeout: 3,
    onnotice: () => {},
  })
  try {
    await admin`select 1`
    return true
  } catch {
    return false
  } finally {
    await admin.end({ timeout: 1 })
  }
}

const clickHouseReachable = await ping(config)
const postgresReachable = await postgresAnswers()
const reachable = clickHouseReachable && postgresReachable

if (!reachable) {
  const missing = [
    clickHouseReachable ? null : `ClickHouse at ${base.url}`,
    postgresReachable ? null : `Postgres at ${POSTGRES_URL}`,
  ].filter((one) => one !== null)

  if (process.env.CLICKHOUSE_TEST_REQUIRED === '1' || process.env.POSTGRES_TEST_REQUIRED === '1') {
    throw new Error(
      `The public API integration tests must not be skipped here, but nothing answered on ${missing.join(' and ')}.`,
    )
  }
  process.stderr.write(
    `\nSkipping the public API integration tests: nothing answered on ${missing.join(' and ')}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

function migrationStatements(): string[] {
  const directory = join(ROOT, 'packages', 'db', 'migrations')
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(directory, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

let sql: postgres.Sql
let maps: string
let seed: Seed
let document: SeedDocument
let app: ReturnType<typeof createApiApp>

function environmentNamed(name: string): { id: string; key: string } {
  const found = seed.environments.find((entry) => entry.name === name)
  const key = found?.keys.find((one) => one.kind === 'secret')
  if (found === undefined || key === undefined) {
    throw new Error(`the seed has no secret key for ${name}`)
  }
  return { id: found.id, key: key.value }
}

async function read(path: string, key: string): Promise<Response> {
  return app.request(
    new Request(`https://api.nekolog.io${path}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
  )
}

async function write(path: string, key: string, payload: unknown): Promise<Response> {
  return app.request(
    new Request(`https://api.nekolog.io${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

const SOURCE_MAP: string = JSON.stringify({
  version: 3,
  sources: ['src/app.ts'],
  mappings: 'AAAA',
})

async function upload(key: string, version: string, name: string, map: string): Promise<Response> {
  const target = new URL('https://api.nekolog.io/v1/sourcemaps')
  target.searchParams.set('release', version)
  target.searchParams.set('name', name)

  return app.request(
    new Request(target, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: map,
    }),
  )
}

async function readJson(path: string, key: string): Promise<Record<string, never>> {
  const response = await read(path, key)
  expect(response.status, `${path} answered ${response.status}`).toBe(200)
  return (await response.json()) as Record<string, never>
}

const AT = '2026-11-04 12:00:00.000'

beforeAll(async () => {
  if (!reachable) {
    return
  }

  maps = await mkdtemp(join(tmpdir(), 'nekolog-api-maps-'))

  await execute(config, `CREATE DATABASE IF NOT EXISTS ${database}`, { database: null })
  await migrate(config)

  const admin = postgres(POSTGRES_URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`create database "${POSTGRES_DATABASE}"`)
  } finally {
    await admin.end({ timeout: 5 })
  }

  sql = postgres(POSTGRES_URL.replace(/\/[^/]*$/, `/${POSTGRES_DATABASE}`), {
    max: 2,
    onnotice: () => {},
  })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }

  seed = await buildSeed({
    organization: 'NekoLog',
    project: 'nekolog',
    environments: ['production', 'staging'],
    retentionDays: 14,
  })
  document = toDocument(seed)

  for (const statement of seedStatements(document)) {
    await sql.unsafe(statement.text, statement.params as never[])
  }

  const run = async (
    text: string,
    params: readonly unknown[],
  ): Promise<ReadonlyArray<Record<string, unknown>>> => sql.unsafe(text, params as never[])

  const keyStore = await keyStoreFromDocument(document)

  app = createApiApp({
    authenticate: createReadAuthenticator({ keyStore }),
    authenticateWrite: createWriteAuthenticator({ keyStore }),
    releases: sqlReleaseStore(run),
    sourceMaps: blobSourceMapStore(fileBlobStore(maps)),
    database,
    query: (statement, params) =>
      queryRows<Record<string, unknown>>(config, statement, { params }) as Promise<
        Array<Record<string, unknown>>
      >,
    issues: sqlIssueReader(run),
    openapi: (origin) => openApiDocument([{ url: origin }]),
    now: () => Date.parse('2026-11-04T13:00:00.000Z'),
  })

  const production = environmentNamed('production')
  const staging = environmentNamed('staging')

  const rows = [
    {
      environment_id: production.id,
      level: 'error',
      message: 'gateway api.timeout while charging',
      service: 'checkout',
      error_type: 'TypeError',
      fingerprint: '18446744073709551615',
      attributes: { orderId: 'ord_7f3a91', status: '503' },
    },
    {
      environment_id: production.id,
      level: 'info',
      message: 'order created',
      service: 'checkout',
      error_type: '',
      fingerprint: '0',
      attributes: { orderId: 'ord_7f3a92', status: '201' },
    },
    {
      environment_id: production.id,
      level: 'warn',
      message: 'retrying the gateway',
      service: 'payments',
      error_type: '',
      fingerprint: '0',
      attributes: { status: '429' },
    },
    {
      environment_id: staging.id,
      level: 'error',
      message: 'staging should never be visible to production',
      service: 'checkout',
      error_type: 'TypeError',
      fingerprint: '18446744073709551615',
      attributes: {},
    },
  ].map((row) => ({
    project_id: seed.project.id,
    timestamp: AT,
    received_at: AT,
    source: 'node',
    release: '1.4.2',
    retention_days: 14,
    ...row,
  }))

  await execute(
    config,
    `INSERT INTO ${database}.logs FORMAT JSONEachRow\n${rows.map((row) => JSON.stringify(row)).join('\n')}`,
    { settings: { input_format_skip_unknown_fields: '0', wait_for_async_insert: '1' } },
  )

  const occurrences: IssueOccurrence[] = [
    {
      projectId: seed.project.id,
      environmentId: production.id,
      fingerprint: '18446744073709551615',
      events: 2,
      firstSeen: Date.parse('2026-11-04T11:00:00.000Z'),
      lastSeen: Date.parse('2026-11-04T12:00:00.000Z'),
      level: 'error',
      errorType: 'TypeError',
      title: 'TypeError: gateway api.timeout while charging',
      service: 'checkout',
      release: '1.4.2',
    },
    {
      projectId: seed.project.id,
      environmentId: staging.id,
      fingerprint: '98765432109876543',
      events: 1,
      firstSeen: Date.parse('2026-11-04T11:30:00.000Z'),
      lastSeen: Date.parse('2026-11-04T11:40:00.000Z'),
      level: 'error',
      errorType: 'RangeError',
      title: 'RangeError: only in staging',
      service: 'checkout',
      release: '1.4.2',
    },
  ]
  await sqlIssueStore(run).record(occurrences)
}, 180_000)

afterAll(async () => {
  if (!reachable) {
    return
  }
  await execute(config, `DROP DATABASE IF EXISTS ${database}`, { database: null })
  await rm(maps, { recursive: true, force: true })
  await sql?.end({ timeout: 5 })
  const admin = postgres(POSTGRES_URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${POSTGRES_DATABASE}" with (force)`)
  } finally {
    await admin.end({ timeout: 5 })
  }
}, 120_000)

describe.skipIf(!reachable)('the public API over a real ClickHouse and a real Postgres', () => {
  it('reads back the logs of this key’s environment, newest first', async () => {
    const { key } = environmentNamed('production')
    const answer = await readJson('/v1/logs?from=2026-11-04T00:00:00Z', key)
    const logs = answer.logs as unknown as Array<Record<string, unknown>>

    expect(logs).toHaveLength(3)
    expect(new Set(logs.map((row) => row.environment_id))).toEqual(
      new Set([environmentNamed('production').id]),
    )
  })

  it('shows one environment nothing of another, which is the whole isolation story', async () => {
    const staging = environmentNamed('staging')
    const answer = await readJson('/v1/logs?from=2026-11-04T00:00:00Z', staging.key)
    const logs = answer.logs as unknown as Array<Record<string, unknown>>

    expect(logs).toHaveLength(1)
    expect(logs[0]?.message).toBe('staging should never be visible to production')

    const production = await readJson(
      '/v1/logs?from=2026-11-04T00:00:00Z',
      environmentNamed('production').key,
    )
    const messages = (production.logs as unknown as Array<Record<string, unknown>>).map(
      (row) => row.message,
    )
    expect(messages).not.toContain('staging should never be visible to production')
  })

  it('runs the search language against real ClickHouse, tokens and phrases alike', async () => {
    const { key } = environmentNamed('production')

    const errors = await readJson('/v1/logs?from=2026-11-04T00:00:00Z&q=level:error', key)
    expect((errors.logs as unknown as unknown[]).length).toBe(1)

    const phrase = await readJson(
      `/v1/logs?from=2026-11-04T00:00:00Z&q=${encodeURIComponent('"api.timeout"')}`,
      key,
    )
    expect((phrase.logs as unknown as unknown[]).length).toBe(1)

    const token = await readJson('/v1/logs?from=2026-11-04T00:00:00Z&q=gateway', key)
    expect((token.logs as unknown as unknown[]).length).toBe(2)

    const service = await readJson('/v1/logs?from=2026-11-04T00:00:00Z&q=service:payments', key)
    expect((service.logs as unknown as unknown[]).length).toBe(1)
  })

  it('compares an attribute as a number, with the attribute name itself bound', async () => {
    const { key } = environmentNamed('production')
    const answer = await readJson(
      `/v1/logs?from=2026-11-04T00:00:00Z&q=${encodeURIComponent('@status>=429')}`,
      key,
    )

    expect((answer.logs as unknown as unknown[]).length).toBe(2)

    const exact = await readJson(
      `/v1/logs?from=2026-11-04T00:00:00Z&q=${encodeURIComponent('@orderId:ord_7f3a91')}`,
      key,
    )
    expect((exact.logs as unknown as unknown[]).length).toBe(1)
  })

  it('refuses a search that reaches for another environment', async () => {
    const { key } = environmentNamed('production')
    const response = await read('/v1/logs?from=2026-11-04T00:00:00Z&q=env:staging', key)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_query' } })
  })

  it('counts the histogram per bucket and level', async () => {
    const { key } = environmentNamed('production')
    const answer = await readJson(
      '/v1/histogram?from=2026-11-04T00:00:00Z&to=2026-11-05T00:00:00Z&bucket=1h',
      key,
    )
    const buckets = answer.buckets as unknown as Array<{ level: string; events: number }>

    expect(buckets.map((one) => one.level).sort()).toEqual(['error', 'info', 'warn'])
    expect(buckets.reduce((total, one) => total + one.events, 0)).toBe(3)
  })

  it('lists the issues of this environment and no other', async () => {
    const production = await readJson('/v1/issues', environmentNamed('production').key)
    const issues = production.issues as unknown as Array<Record<string, unknown>>

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      status: 'open',
      errorType: 'TypeError',
      events: 2,
      service: 'checkout',
    })
    expect(issues[0]?.fingerprint).toBe('18446744073709551615')
    expect(production.nextCursor).toBeNull()

    const staging = await readJson('/v1/issues', environmentNamed('staging').key)
    const theirs = staging.issues as unknown as Array<Record<string, unknown>>
    expect(theirs).toHaveLength(1)
    expect(theirs[0]?.errorType).toBe('RangeError')
  })

  it('filters issues by status, and finds none that is resolved yet', async () => {
    const { key } = environmentNamed('production')

    expect(
      ((await readJson('/v1/issues?status=open', key)).issues as unknown as unknown[]).length,
    ).toBe(1)
    expect(
      ((await readJson('/v1/issues?status=resolved', key)).issues as unknown as unknown[]).length,
    ).toBe(0)
  })

  it('turns a public key away, even though the seed minted one for this environment', async () => {
    const found = seed.environments.find((entry) => entry.name === 'production')
    const publicKey = found?.keys.find((one) => one.kind === 'public')?.value as string

    const response = await read('/v1/logs', publicKey)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_key' } })
  })

  it('serves an OpenAPI document that names every route it just answered on', async () => {
    const response = await app.request('https://api.nekolog.io/openapi.json')
    const served = (await response.json()) as { paths: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(Object.keys(served.paths).sort()).toEqual([
      '/health',
      '/openapi.json',
      '/v1/histogram',
      '/v1/issues',
      '/v1/logs',
      '/v1/releases',
      '/v1/sourcemaps',
    ])
  })

  it('records a release into real Postgres, and records it again harmlessly', async () => {
    const { key } = environmentNamed('production')

    const first = await write('/v1/releases', key, {
      version: '1.4.2',
      commit: '9f3a1c7',
      releasedAt: '2026-11-04T10:00:00.000Z',
    })
    expect(first.status).toBe(201)
    const created = (await first.json()) as { created: boolean; release: Record<string, unknown> }

    expect(created.created).toBe(true)
    expect(created.release).toMatchObject({
      projectId: seed.project.id,
      environmentId: environmentNamed('production').id,
      version: '1.4.2',
      commit: '9f3a1c7',
      sourcemapCount: 0,
      releasedAt: '2026-11-04T10:00:00.000Z',
    })
    expect(String(created.release.id)).toMatch(/^rel_[0-9A-HJKMNP-TV-Z]{26}$/)

    const again = await write('/v1/releases', key, {
      version: '1.4.2',
      releasedAt: '2026-11-04T18:00:00.000Z',
    })
    const found = (await again.json()) as { created: boolean; release: Record<string, unknown> }

    expect(again.status).toBe(201)
    expect(found.created).toBe(false)
    expect(found.release.id).toBe(created.release.id)
    expect(found.release.commit).toBe('9f3a1c7')
    expect(found.release.releasedAt).toBe('2026-11-04T10:00:00.000Z')

    const rows = await sql`select count(*)::int as total from releases where version = '1.4.2'`
    expect(rows[0]?.total).toBe(1)
  })

  it('keeps one environment’s release out of another’s', async () => {
    await write('/v1/releases', environmentNamed('staging').key, { version: 'only-in-staging' })

    const rows = await sql`
      select environment_id from releases where version = 'only-in-staging'
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]?.environment_id).toBe(environmentNamed('staging').id)
  })

  it('stores a source map on disk and counts it on the release row', async () => {
    const { key } = environmentNamed('production')
    await write('/v1/releases', key, { version: '2.0.0' })

    const first = await upload(key, '2.0.0', 'app.js.map', SOURCE_MAP)
    expect(first.status, await first.clone().text()).toBe(201)
    expect(await first.json()).toMatchObject({
      sourceMap: { name: 'app.js.map' },
      release: { version: '2.0.0', sourcemapCount: 1 },
    })

    const second = await upload(key, '2.0.0', 'vendor.js.map', SOURCE_MAP)
    expect(
      ((await second.json()) as { release: { sourcemapCount: number } }).release.sourcemapCount,
    ).toBe(2)

    const rows = await sql`select id, sourcemap_count from releases where version = '2.0.0'`
    expect(rows[0]?.sourcemap_count).toBe(2)

    const onDisk = await readdir(join(maps, 'sourcemaps', seed.project.id, String(rows[0]?.id)))
    expect(onDisk.sort()).toEqual(['app.js.map', 'vendor.js.map'])
  })

  it('does not raise the count when the same map is uploaded again', async () => {
    const { key } = environmentNamed('production')
    await write('/v1/releases', key, { version: '2.1.0' })

    await upload(key, '2.1.0', 'app.js.map', SOURCE_MAP)
    const again = await upload(key, '2.1.0', 'app.js.map', SOURCE_MAP)

    expect(
      ((await again.json()) as { release: { sourcemapCount: number } }).release.sourcemapCount,
    ).toBe(1)

    const rows = await sql`select sourcemap_count from releases where version = '2.1.0'`
    expect(rows[0]?.sourcemap_count).toBe(1)
  })

  it('refuses a map for a release this environment never recorded', async () => {
    const response = await upload(
      environmentNamed('production').key,
      'never-recorded',
      'app.js.map',
      SOURCE_MAP,
    )

    expect(response.status).toBe(404)
    expect(existsSync(join(maps, 'sourcemaps'))).toBe(true)
  })

  it('refuses a name that would escape the release folder', async () => {
    const { key } = environmentNamed('production')
    await write('/v1/releases', key, { version: '2.2.0' })

    for (const name of ['../escape.map', 'a/b.map', 'app.js']) {
      const response = await upload(key, '2.2.0', name, SOURCE_MAP)
      expect(response.status, name).toBe(400)
    }

    const rows = await sql`select sourcemap_count from releases where version = '2.2.0'`
    expect(rows[0]?.sourcemap_count).toBe(0)
  })

  it('refuses a public key on the one route that writes', async () => {
    const found = seed.environments.find((entry) => entry.name === 'production')
    const publicKey = found?.keys.find((one) => one.kind === 'public')?.value as string

    const response = await write('/v1/releases', publicKey, { version: 'never-lands' })
    const rows =
      await sql`select count(*)::int as total from releases where version = 'never-lands'`

    expect(response.status).toBe(401)
    expect(rows[0]?.total).toBe(0)
  })
})

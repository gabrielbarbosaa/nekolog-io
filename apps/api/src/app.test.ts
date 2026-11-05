import type {
  IssuePage,
  IssueQuery,
  IssueReader,
  Release,
  ReleaseInput,
  ReleaseStore,
} from '@nekolog-io/adapters'
import {
  assertCommit,
  assertVersion,
  blobSourceMapStore,
  encodeIssueCursor,
  MAX_SOURCE_MAP_BYTES,
  memoryBlobStore,
  memoryRateLimiter,
} from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import { type ApiDeps, createApiApp, UNKNOWN_VERSION } from './app.ts'
import type { ApiPrincipal } from './authenticate.ts'
import { MAX_BODY_BYTES } from './body.ts'
import { openApiDocument } from './openapi.ts'

const PRINCIPAL: ApiPrincipal = { projectId: 'prj_1', environmentId: 'env_1' }

type Asked = { sql: string; params: Record<string, string> }

function build(overrides: Partial<ApiDeps> = {}): {
  app: ReturnType<typeof createApiApp>
  asked: Asked[]
} {
  const asked: Asked[] = []
  const app = createApiApp({
    authenticate: () => ({ ok: true, principal: PRINCIPAL }),
    database: 'nekolog_dev',
    query: async (sql, params) => {
      asked.push({ sql, params })
      return []
    },
    now: () => Date.parse('2026-11-04T12:00:00.000Z'),
    ...overrides,
  })
  return { app, asked }
}

function listing(issues: IssuePage['issues'], seen: IssueQuery[]): IssueReader {
  return {
    list: async (query) => {
      seen.push(query)
      return { issues, nextCursor: null }
    },
  }
}

const RELEASE_ID = 'rel_0123456789ABCDEFGHJKMNPQRS'

const MAP: string = JSON.stringify({ version: 3, sources: ['src/app.ts'], mappings: 'AAAA' })

function recording(seen: ReleaseInput[], counted: Array<[string, number]> = []): ReleaseStore {
  const made = (input: ReleaseInput): Release => ({
    id: RELEASE_ID,
    projectId: input.projectId,
    environmentId: input.environmentId,
    version: input.version,
    commit: input.commit ?? null,
    sourcemapCount: 0,
    releasedAt: '2026-11-04T12:00:00.000Z',
    createdAt: '2026-11-04T12:00:00.000Z',
  })

  return {
    record: async (input) => {
      assertVersion(input.version)
      assertCommit(input.commit)
      seen.push(input)
      return { created: true, release: made(input) }
    },
    byVersion: async (environmentId, version) =>
      made({ projectId: PRINCIPAL.projectId, environmentId, version }),
    countSourceMaps: async (releaseId, total) => {
      counted.push([releaseId, total])
    },
  }
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('the public read API', () => {
  it('answers /health without asking for a key', async () => {
    const { app } = build({
      authenticate: () => ({ ok: false, code: 'invalid_key', message: 'no' }),
    })
    const response = await app.request('http://api.test/health')

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ status: 'ok', service: 'api', version: UNKNOWN_VERSION })
  })

  it('reports the version it was deployed with, so a report can name one', async () => {
    const { app } = build({ version: '1.0.0' })
    const response = await app.request('http://api.test/health')

    expect(await body(response)).toEqual({ status: 'ok', service: 'api', version: '1.0.0' })
  })

  it('scopes every search to the key, never to anything in the query string', async () => {
    const { app, asked } = build()
    const response = await app.request('http://api.test/v1/logs?q=level:error')

    expect(response.status).toBe(200)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.params.s_project).toBe('prj_1')
    expect(asked[0]?.params.s_env0).toBe('env_1')
  })

  it('builds the scope from the key and from nothing the request carries', async () => {
    for (const path of [
      '/v1/logs?q=prj_2&order=prj_2&limit=10',
      '/v1/histogram?q=prj_2&bucket=15m',
    ]) {
      const { app, asked } = build()
      await app.request(`http://api.test${path}`)

      const scope = Object.entries(asked[0]?.params ?? {}).filter(([name]) => name.startsWith('s_'))

      expect(asked[0]?.params.s_project, path).toBe('prj_1')
      expect(asked[0]?.params.s_env0, path).toBe('env_1')
      expect(
        scope.map(([, value]) => value),
        path,
      ).not.toContain('prj_2')
      expect(
        scope.map(([, value]) => value),
        path,
      ).not.toContain('15m')
    }
  })

  it('refuses a caller who tries to name a project or an environment at all', async () => {
    for (const smuggled of ['project=prj_2', 'environment=env_2', 'projectId=prj_3']) {
      const { app, asked } = build()
      const response = await app.request(`http://api.test/v1/logs?q=level:error&${smuggled}`)
      const body = (await response.json()) as { error: { code: string } }

      expect(response.status, smuggled).toBe(400)
      expect(body.error.code, smuggled).toBe('invalid_query')
      expect(asked, smuggled).toHaveLength(0)
    }
  })

  it('puts exactly one environment in the query, never a second one', async () => {
    for (const path of ['/v1/logs', '/v1/histogram']) {
      const { app, asked } = build()
      const response = await app.request(`http://api.test${path}`)
      expect(response.status, path).toBe(200)

      const params = asked[0]?.params ?? {}
      const environments = Object.keys(params).filter((name) => /^s_env\d+$/.test(name))

      expect(environments, path).toEqual(['s_env0'])
      expect(params.s_env0, path).toBe('env_1')
      expect(asked[0]?.sql, path).toContain('environment_id IN ({s_env0:String})')
    }
  })

  it('never lets a caller read another environment through env:', async () => {
    const { app, asked } = build()
    const response = await app.request('http://api.test/v1/logs?q=env:production')

    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ error: { code: 'invalid_query' } })
    expect(asked).toHaveLength(0)
  })

  it('refuses the request the authenticator refused, and never caches the answer', async () => {
    const { app, asked } = build({
      authenticate: () => ({ ok: false, code: 'insufficient_scope', message: 'no read scope' }),
    })
    const response = await app.request('http://api.test/v1/logs')

    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await body(response)).toMatchObject({ error: { code: 'insufficient_scope' } })
    expect(asked).toHaveLength(0)
  })

  it('refuses a period it cannot read, before it asks ClickHouse anything', async () => {
    const { app, asked } = build()
    const response = await app.request('http://api.test/v1/logs?from=2020-01-01T00:00:00Z')

    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ error: { code: 'period_too_long' } })
    expect(asked).toHaveLength(0)
  })

  it('tells nobody what the log store said when the log store fails', async () => {
    const { app } = build({
      query: async () => {
        throw new Error(
          'ClickHouse returned HTTP 500: Code: 47. DB::Exception: Unknown column secret_column',
        )
      },
    })
    const response = await app.request('http://api.test/v1/logs')
    const answered = JSON.stringify(await body(response))

    expect(response.status).toBe(503)
    expect(answered).toContain('upstream_unavailable')
    expect(answered).not.toContain('DB::Exception')
    expect(answered).not.toContain('secret_column')
  })

  it('holds a key back once it has had its share of the minute', async () => {
    const { app } = build({
      limits: { rateLimiter: memoryRateLimiter(), requestsPerWindow: 1 },
    })

    expect((await app.request('http://api.test/v1/logs')).status).toBe(200)

    const refused = await app.request('http://api.test/v1/logs')
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(0)
  })

  it('counts the histogram per bucket and level, and refuses a bucket nobody offered', async () => {
    const { app, asked } = build({
      query: async (sql, params) => {
        asked.push({ sql, params })
        return [{ bucket: '2026-11-04 11:00:00', level: 'error', events: 3 }]
      },
    })

    const response = await app.request('http://api.test/v1/histogram?bucket=1h')
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({
      bucket: '1h',
      buckets: [{ at: '2026-11-04 11:00:00', level: 'error', events: 3 }],
    })

    const refused = await app.request('http://api.test/v1/histogram?bucket=3m')
    expect(refused.status).toBe(400)
  })

  it('refuses a bucket that would be more points than it returns', async () => {
    const { app, asked } = build()
    const response = await app.request(
      'http://api.test/v1/histogram?bucket=1m&from=2026-10-20T00:00:00Z&to=2026-11-04T00:00:00Z',
    )

    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ error: { code: 'invalid_query' } })
    expect(asked).toHaveLength(0)
  })

  it('says plainly that it serves no issues when nothing wired a reader', async () => {
    const { app } = build()
    const response = await app.request('http://api.test/v1/issues')

    expect(response.status).toBe(404)
    expect(await body(response)).toMatchObject({ error: { code: 'not_found' } })
  })

  it('lists the issues of the key’s own environment, never of the whole project', async () => {
    const seen: IssueQuery[] = []
    const { app } = build({ issues: listing([], seen) })

    const response = await app.request(
      'http://api.test/v1/issues?status=open,resolved&limit=10&since=2026-11-01T00:00:00Z',
    )

    expect(response.status).toBe(200)
    expect(seen[0]).toMatchObject({
      projectId: 'prj_1',
      environmentId: 'env_1',
      statuses: ['open', 'resolved'],
      limit: 10,
    })
    expect(seen[0]?.since?.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('refuses a status nobody defined and a moment it cannot read', async () => {
    const seen: IssueQuery[] = []
    const { app } = build({ issues: listing([], seen) })

    expect((await app.request('http://api.test/v1/issues?status=deleted')).status).toBe(400)
    expect((await app.request('http://api.test/v1/issues?since=yesterday')).status).toBe(400)
    expect(seen).toHaveLength(0)
  })

  it('turns a cursor it did not hand out into a refusal, not a server error', async () => {
    const { app } = build({
      issues: {
        list: async () => {
          const { decodeIssueCursor } = await import('@nekolog-io/adapters')
          decodeIssueCursor('forged')
          return { issues: [], nextCursor: null }
        },
      },
    })

    const response = await app.request('http://api.test/v1/issues?cursor=forged')
    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ error: { code: 'invalid_query' } })
  })

  it('passes a cursor it did hand out straight through', async () => {
    const seen: IssueQuery[] = []
    const { app } = build({ issues: listing([], seen) })
    const cursor = encodeIssueCursor('2026-11-04T10:00:00.000Z', 'iss_0123456789ABCDEFGHJKMNPQRS')

    await app.request(`http://api.test/v1/issues?cursor=${encodeURIComponent(cursor)}`)
    expect(seen[0]?.cursor).toBe(cursor)
  })

  it('serves its OpenAPI document against the address it was reached on', async () => {
    const { app } = build({ openapi: (origin) => openApiDocument([{ url: origin }]) })
    const response = await app.request('https://api-dev.nekolog.io/openapi.json')

    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({
      servers: [{ url: 'https://api-dev.nekolog.io' }],
    })
  })

  it('writes on one route only: every other path refuses every other method', async () => {
    const { app, asked } = build({ issues: listing([], []) })

    for (const path of ['/v1/logs', '/v1/histogram', '/v1/issues', '/health', '/openapi.json']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await app.request(`http://api.test${path}`, { method })
        expect(response.status, `${method} ${path}`).toBe(404)
      }
    }

    for (const path of ['/v1/releases', '/v1/sourcemaps']) {
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        const response = await app.request(`http://api.test${path}`, { method })
        expect(response.status, `${method} ${path}`).toBe(404)
      }
    }

    expect(asked).toHaveLength(0)
  })

  it('records a release on the key’s own project and environment', async () => {
    const seen: ReleaseInput[] = []
    const { app } = build({ releases: recording(seen) })

    const response = await app.request('http://api.test/v1/releases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: '1.4.2', commit: '9f3a1c7', projectId: 'prj_2' }),
    })

    expect(response.status).toBe(201)
    expect(await body(response)).toMatchObject({ created: true, release: { version: '1.4.2' } })
    expect(seen[0]).toMatchObject({
      projectId: 'prj_1',
      environmentId: 'env_1',
      version: '1.4.2',
      commit: '9f3a1c7',
    })
  })

  it('demands a key that may write, not merely one that may read', async () => {
    const seen: ReleaseInput[] = []
    const { app } = build({
      releases: recording(seen),
      authenticateWrite: () => ({
        ok: false,
        code: 'insufficient_scope',
        message: 'This key does not carry the logs:write scope',
      }),
    })

    const response = await app.request('http://api.test/v1/releases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: '1.4.2' }),
    })

    expect(response.status).toBe(403)
    expect(seen).toHaveLength(0)
  })

  it('turns a bad version or commit into a refusal, not a server error', async () => {
    const seen: ReleaseInput[] = []
    const { app } = build({ releases: recording(seen) })

    for (const payload of [{}, { version: ' 1.4.2' }, { version: '1.4.2', commit: 'NOPE' }]) {
      const response = await app.request('http://api.test/v1/releases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(response.status, JSON.stringify(payload)).toBe(400)
    }
  })

  it('refuses a body that is not declared as JSON, or is too big', async () => {
    const seen: ReleaseInput[] = []
    const { app } = build({ releases: recording(seen) })

    const wrongType = await app.request('http://api.test/v1/releases', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ version: '1.4.2' }),
    })
    expect(wrongType.status).toBe(415)

    const huge = await app.request('http://api.test/v1/releases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: '1.4.2', padding: 'x'.repeat(MAX_BODY_BYTES) }),
    })
    expect(huge.status).toBe(413)

    expect(seen).toHaveLength(0)
  })

  it('says plainly that it records no releases when nothing wired a store', async () => {
    const { app } = build()
    const response = await app.request('http://api.test/v1/releases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: '1.4.2' }),
    })

    expect(response.status).toBe(404)
    expect(await body(response)).toMatchObject({ error: { code: 'not_found' } })
  })

  it('stores a source map against a release that exists', async () => {
    const blobs = memoryBlobStore()
    const counted: Array<[string, number]> = []
    const { app } = build({
      releases: recording([], counted),
      sourceMaps: blobSourceMapStore(blobs),
    })

    const response = await app.request(
      'http://api.test/v1/sourcemaps?release=1.4.2&name=app.js.map',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: MAP },
    )

    expect(response.status).toBe(201)
    expect(await body(response)).toMatchObject({
      sourceMap: { name: 'app.js.map' },
      release: { version: '1.4.2', sourcemapCount: 1 },
    })
    expect(await blobs.list('')).toEqual([
      'sourcemaps/prj_1/rel_0123456789ABCDEFGHJKMNPQRS/app.js.map',
    ])
    expect(counted).toEqual([['rel_0123456789ABCDEFGHJKMNPQRS', 1]])
  })

  it('keys the map on the principal, whatever the caller puts in the query string', async () => {
    const blobs = memoryBlobStore()
    const { app } = build({ releases: recording([], []), sourceMaps: blobSourceMapStore(blobs) })

    const response = await app.request(
      'http://api.test/v1/sourcemaps?release=1.4.2&name=app.js.map&project=prj_2&environment=env_2&releaseId=rel_evil',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: MAP },
    )

    expect(response.status).toBe(201)
    const keys = await blobs.list('')
    expect(keys).toEqual([`sourcemaps/prj_1/${RELEASE_ID}/app.js.map`])
    expect(keys.join()).not.toContain('prj_2')
    expect(keys.join()).not.toContain('rel_evil')
  })

  it('refuses a release this environment never recorded, and writes nothing', async () => {
    const blobs = memoryBlobStore()
    const { app } = build({
      releases: { ...recording([], []), byVersion: async () => null },
      sourceMaps: blobSourceMapStore(blobs),
    })

    const response = await app.request(
      'http://api.test/v1/sourcemaps?release=9.9.9&name=app.js.map',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: MAP },
    )

    expect(response.status).toBe(404)
    expect(JSON.stringify(await body(response))).toContain('Record it first')
    expect(await blobs.list('')).toEqual([])
  })

  it('refuses a name that could reach out of its own directory', async () => {
    const blobs = memoryBlobStore()
    const { app } = build({ releases: recording([], []), sourceMaps: blobSourceMapStore(blobs) })

    for (const name of ['../escape.map', 'a%2Fb.map', 'app.js', '']) {
      const response = await app.request(
        `http://api.test/v1/sourcemaps?release=1.4.2&name=${encodeURIComponent(name)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: MAP },
      )
      expect(response.status, JSON.stringify(name)).toBe(400)
    }

    expect(await blobs.list('')).toEqual([])
  })

  it('answers 413 for a map over the limit, by what arrived as well as what was declared', async () => {
    const blobs = memoryBlobStore()
    const { app } = build({ releases: recording([], []), sourceMaps: blobSourceMapStore(blobs) })

    const declared = await app.request(
      'http://api.test/v1/sourcemaps?release=1.4.2&name=app.js.map',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(MAX_SOURCE_MAP_BYTES + 1),
        },
        body: MAP,
      },
    )
    expect(declared.status).toBe(413)

    const arrived = await app.request(
      'http://api.test/v1/sourcemaps?release=1.4.2&name=app.js.map',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new Uint8Array(MAX_SOURCE_MAP_BYTES + 1).fill(0x7b),
      },
    )
    expect(arrived.status).toBe(413)
    expect(await blobs.list('')).toEqual([])
  })

  it('needs a key that may write, and says which release it wants', async () => {
    const blobs = memoryBlobStore()
    const { app } = build({
      releases: recording([], []),
      sourceMaps: blobSourceMapStore(blobs),
      authenticateWrite: () => ({
        ok: false,
        code: 'insufficient_scope',
        message: 'no logs:write',
      }),
    })

    const refused = await app.request(
      'http://api.test/v1/sourcemaps?release=1.4.2&name=app.js.map',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: MAP },
    )
    expect(refused.status).toBe(403)

    const { app: open } = build({
      releases: recording([], []),
      sourceMaps: blobSourceMapStore(memoryBlobStore()),
    })
    const nameless = await open.request('http://api.test/v1/sourcemaps?name=app.js.map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MAP,
    })
    expect(nameless.status).toBe(400)
  })

  it('says plainly that it stores no source maps when nothing wired a store', async () => {
    const { app } = build({ releases: recording([], []) })
    const response = await app.request(
      'http://api.test/v1/sourcemaps?release=1.4.2&name=app.js.map',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: MAP },
    )

    expect(response.status).toBe(404)
  })

  it('answers 404 for an endpoint that does not exist', async () => {
    const { app } = build()
    const response = await app.request('http://api.test/v1/nope')

    expect(response.status).toBe(404)
    expect(await body(response)).toMatchObject({ error: { code: 'not_found' } })
  })
})

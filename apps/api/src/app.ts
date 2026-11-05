import { apiHeaders } from '@internal/security-headers'
import type {
  IssueReader,
  IssueStatus,
  RateLimiter,
  ReleaseStore,
  SourceMapStore,
} from '@nekolog-io/adapters'
import {
  InvalidRelease,
  InvalidSourceMap,
  ISSUE_STATUSES,
  IssueCursorError,
  MAX_ISSUE_ROWS,
  MAX_SOURCE_MAP_BYTES,
} from '@nekolog-io/adapters'
import {
  bucketSecondsFor,
  DEFAULT_HISTOGRAM_BUCKET,
  DEFAULT_SEARCH_ROWS,
  HISTOGRAM_BUCKETS,
  logHistogramQuery,
  logSearchQuery,
  MAX_HISTOGRAM_BUCKETS,
  MAX_SEARCH_ROWS,
  SearchError,
  type SearchScope,
} from '@nekolog-io/clickhouse/search'
import { Hono } from 'hono'
import type { ApiPrincipal, Authenticator } from './authenticate.ts'
import { readJsonObject } from './body.ts'
import { ApiError, type ApiErrorCode, errorBody, statusFor } from './errors.ts'
import { assertKnownParams, parseCount, parseMoment, parsePeriod } from './period.ts'

export const DEFAULT_REQUESTS_PER_MINUTE = 120
export const RATE_WINDOW_SECONDS = 60

export const LOG_PARAMS: readonly string[] = ['from', 'to', 'limit', 'order', 'q']
export const HISTOGRAM_PARAMS: readonly string[] = ['from', 'to', 'bucket', 'q']
export const ISSUE_PARAMS: readonly string[] = ['limit', 'status', 'cursor', 'since', 'until']

export type ClickHouseQuery = (
  sql: string,
  params: Record<string, string>,
) => Promise<Array<Record<string, unknown>>>

export type ApiLimits = {
  rateLimiter: RateLimiter
  requestsPerWindow?: number
  windowSeconds?: number
}

export type ApiDeps = {
  authenticate: Authenticator
  authenticateWrite?: Authenticator
  query: ClickHouseQuery
  database: string
  issues?: IssueReader
  releases?: ReleaseStore
  sourceMaps?: SourceMapStore
  openapi?: (origin: string) => unknown
  limits?: ApiLimits
  onError?: (error: unknown) => void
  now?: () => number
  version?: string
}

export const UNKNOWN_VERSION = 'unknown'

function report(deps: ApiDeps, error: unknown): void {
  try {
    deps.onError?.(error)
  } catch {
    return
  }
}

function scopeFor(principal: ApiPrincipal, from: Date, to: Date): SearchScope {
  return {
    projectId: principal.projectId,
    environmentIds: [principal.environmentId],
    from,
    to,
  }
}

function statusesFrom(params: URLSearchParams): readonly IssueStatus[] | undefined {
  const raw = params.getAll('status').flatMap((value) => value.split(','))
  const wanted = raw.map((value) => value.trim()).filter((value) => value !== '')
  if (wanted.length === 0) {
    return undefined
  }
  for (const value of wanted) {
    if (!ISSUE_STATUSES.includes(value as IssueStatus)) {
      throw new ApiError(
        'invalid_query',
        `There is no issue status called ${JSON.stringify(value)}. The statuses are ${ISSUE_STATUSES.join(', ')}.`,
      )
    }
  }
  return wanted as IssueStatus[]
}

function bucketFrom(params: URLSearchParams): string {
  const raw = params.get('bucket')
  if (raw === null || raw.trim() === '') {
    return DEFAULT_HISTOGRAM_BUCKET
  }
  const wanted = raw.trim()
  if (!HISTOGRAM_BUCKETS.includes(wanted)) {
    throw new ApiError(
      'invalid_query',
      `There is no bucket called ${JSON.stringify(wanted)}. The buckets are ${HISTOGRAM_BUCKETS.join(', ')}.`,
    )
  }
  return wanted
}

export const API_HEADERS: Readonly<Record<string, string>> = apiHeaders()

export function createApiApp(deps: ApiDeps): Hono {
  const app = new Hono()
  const now = (): number => (deps.now ?? Date.now)()

  app.use('*', async (c, next) => {
    await next()
    for (const [name, value] of Object.entries(API_HEADERS)) {
      c.res.headers.set(name, value)
    }
  })

  const fail = (code: ApiErrorCode, message: string, retryAfter: number | null = null): Response =>
    Response.json(errorBody(code, message, retryAfter), {
      status: statusFor(code),
      headers:
        retryAfter === null
          ? { 'cache-control': 'no-store' }
          : {
              'cache-control': 'no-store',
              'retry-after': String(Math.max(0, Math.ceil(retryAfter))),
            },
    })

  const allow = async (principal: ApiPrincipal): Promise<Response | null> => {
    const limits = deps.limits
    if (limits === undefined) {
      return null
    }
    try {
      const verdict = await limits.rateLimiter.consume(
        `${principal.projectId}:${principal.environmentId}`,
        limits.requestsPerWindow ?? DEFAULT_REQUESTS_PER_MINUTE,
        limits.windowSeconds ?? RATE_WINDOW_SECONDS,
        1,
      )
      return verdict.allowed
        ? null
        : fail('rate_limited', 'Too many requests for this key', verdict.retryAfterSeconds)
    } catch (error) {
      report(deps, error)
      return null
    }
  }

  const admitWith = async (
    authenticate: Authenticator,
    request: Request,
  ): Promise<ApiPrincipal | Response> => {
    const auth = await authenticate(request)
    if (!auth.ok) {
      return fail(auth.code, auth.message)
    }
    const refused = await allow(auth.principal)
    return refused ?? auth.principal
  }

  const admit = (request: Request): Promise<ApiPrincipal | Response> =>
    admitWith(deps.authenticate, request)

  const admitWriter = (request: Request): Promise<ApiPrincipal | Response> =>
    admitWith(deps.authenticateWrite ?? deps.authenticate, request)

  const upstream = async (
    sql: string,
    params: Record<string, string>,
  ): Promise<Array<Record<string, unknown>> | Response> => {
    try {
      return await deps.query(sql, params)
    } catch (error) {
      report(deps, error)
      return fail('upstream_unavailable', 'The log store did not answer this query')
    }
  }

  app.get('/health', (c) =>
    c.json({ status: 'ok', service: 'api', version: deps.version ?? UNKNOWN_VERSION }),
  )

  app.get('/openapi.json', (c) => {
    const document = deps.openapi
    if (document === undefined) {
      return fail('not_found', 'This deployment serves no OpenAPI document')
    }
    return c.json(document(new URL(c.req.raw.url).origin) as Record<string, unknown>)
  })

  app.get('/v1/logs', async (c) => {
    const admitted = await admit(c.req.raw)
    if (admitted instanceof Response) {
      return admitted
    }

    const params = new URL(c.req.raw.url).searchParams
    assertKnownParams(params, LOG_PARAMS)
    const period = parsePeriod(params, now())
    const limit = parseCount(params, 'limit', DEFAULT_SEARCH_ROWS, MAX_SEARCH_ROWS)
    const order = params.get('order') === 'oldest' ? 'oldest' : 'newest'

    const built = logSearchQuery(
      params.get('q') ?? '',
      scopeFor(admitted, period.from, period.to),
      { database: deps.database },
      { limit, order },
    )

    const rows = await upstream(built.sql, built.params)
    if (rows instanceof Response) {
      return rows
    }

    return c.json(
      {
        logs: rows,
        period: { from: period.from.toISOString(), to: period.to.toISOString() },
        limit,
        order,
      },
      200,
      { 'cache-control': 'no-store' },
    )
  })

  app.get('/v1/histogram', async (c) => {
    const admitted = await admit(c.req.raw)
    if (admitted instanceof Response) {
      return admitted
    }

    const params = new URL(c.req.raw.url).searchParams
    assertKnownParams(params, HISTOGRAM_PARAMS)
    const period = parsePeriod(params, now())
    const bucket = bucketFrom(params)

    const points = Math.ceil(
      (period.to.getTime() - period.from.getTime()) / 1000 / bucketSecondsFor(bucket),
    )
    if (points > MAX_HISTOGRAM_BUCKETS) {
      return fail(
        'invalid_query',
        `A ${bucket} bucket over this period would be ${points} points, and the most is ${MAX_HISTOGRAM_BUCKETS}. Ask for a wider bucket or a shorter period.`,
      )
    }

    const built = logHistogramQuery(
      params.get('q') ?? '',
      scopeFor(admitted, period.from, period.to),
      { database: deps.database },
      { bucket },
    )

    const rows = await upstream(built.sql, built.params)
    if (rows instanceof Response) {
      return rows
    }

    return c.json(
      {
        buckets: rows.map((row) => ({
          at: String(row.bucket),
          level: String(row.level),
          events: Number(row.events ?? 0),
        })),
        bucket,
        period: { from: period.from.toISOString(), to: period.to.toISOString() },
      },
      200,
      { 'cache-control': 'no-store' },
    )
  })

  app.get('/v1/issues', async (c) => {
    const admitted = await admit(c.req.raw)
    if (admitted instanceof Response) {
      return admitted
    }

    const reader = deps.issues
    if (reader === undefined) {
      return fail('not_found', 'This deployment serves no issues')
    }

    const params = new URL(c.req.raw.url).searchParams
    assertKnownParams(params, ISSUE_PARAMS)
    const limit = parseCount(params, 'limit', 50, MAX_ISSUE_ROWS)
    const statuses = statusesFrom(params)
    const rawSince = params.get('since')
    const rawUntil = params.get('until')

    const page = await reader.list({
      projectId: admitted.projectId,
      environmentId: admitted.environmentId,
      limit,
      cursor: params.get('cursor'),
      ...(statuses === undefined ? {} : { statuses }),
      ...(rawSince === null ? {} : { since: parseMoment(rawSince, 'since') }),
      ...(rawUntil === null ? {} : { until: parseMoment(rawUntil, 'until') }),
    })

    return c.json({ issues: page.issues, nextCursor: page.nextCursor }, 200, {
      'cache-control': 'no-store',
    })
  })

  app.post('/v1/releases', async (c) => {
    const store = deps.releases
    if (store === undefined) {
      return fail('not_found', 'This deployment records no releases')
    }

    const admitted = await admitWriter(c.req.raw)
    if (admitted instanceof Response) {
      return admitted
    }

    const body = await readJsonObject(c.req.raw)
    const rawReleasedAt = body.releasedAt

    const recorded = await store.record({
      projectId: admitted.projectId,
      environmentId: admitted.environmentId,
      version: body.version as string,
      commit: (body.commit ?? null) as string | null,
      ...(rawReleasedAt === undefined || rawReleasedAt === null
        ? {}
        : { releasedAt: parseMoment(String(rawReleasedAt), 'releasedAt') }),
    })

    return c.json({ release: recorded.release, created: recorded.created }, 201, {
      'cache-control': 'no-store',
    })
  })

  app.post('/v1/sourcemaps', async (c) => {
    const maps = deps.sourceMaps
    const releases = deps.releases
    if (maps === undefined || releases === undefined) {
      return fail('not_found', 'This deployment stores no source maps')
    }

    const admitted = await admitWriter(c.req.raw)
    if (admitted instanceof Response) {
      return admitted
    }

    const params = new URL(c.req.raw.url).searchParams
    const version = params.get('release')
    if (version === null || version === '') {
      throw new ApiError('invalid_query', 'Which release? Pass ?release=<version>.')
    }
    const name = params.get('name')

    const declared = Number(c.req.header('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_SOURCE_MAP_BYTES) {
      return fail('payload_too_large', `A source map is at most ${MAX_SOURCE_MAP_BYTES} bytes.`)
    }

    const release = await releases.byVersion(admitted.environmentId, version)
    if (release === null) {
      return fail(
        'not_found',
        `There is no release called ${JSON.stringify(version)} in this environment. Record it first.`,
      )
    }

    const body = new Uint8Array(await c.req.raw.arrayBuffer())
    const stored = await maps.put({
      projectId: admitted.projectId,
      releaseId: release.id,
      name: name ?? '',
      body,
    })

    await releases.countSourceMaps(release.id, stored.total)

    return c.json(
      {
        sourceMap: { name: stored.name, bytes: stored.bytes },
        release: { id: release.id, version: release.version, sourcemapCount: stored.total },
      },
      201,
      { 'cache-control': 'no-store' },
    )
  })

  app.notFound(() => fail('not_found', 'No such endpoint'))

  app.onError((error) => {
    if (error instanceof ApiError) {
      return fail(error.code, error.message, error.retryAfter)
    }
    if (error instanceof SearchError) {
      return fail('invalid_query', error.message)
    }
    if (error instanceof IssueCursorError) {
      return fail('invalid_query', error.message)
    }
    if (error instanceof InvalidRelease) {
      return fail('invalid_query', `${error.field}: ${error.message}`)
    }
    if (error instanceof InvalidSourceMap) {
      return fail(
        error.oversize ? 'payload_too_large' : 'invalid_query',
        `${error.field}: ${error.message}`,
      )
    }
    report(deps, error)
    return fail('internal_error', 'Unexpected error')
  })

  return app
}

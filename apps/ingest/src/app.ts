import type { RateLimiter, RateLimitResult } from '@internal/adapters'
import { type BatchErrorCode, type ParsedBatch, parseBatch } from '@internal/schema'
import { Hono } from 'hono'
import { type ReadBodyOptions, readBatchBody } from './body.ts'
import { corsHeadersFor, preflightHeadersFor, withCors } from './cors.ts'
import { errorBody, statusFor } from './errors.ts'

export type IngestPrincipal = {
  projectId: string
  environmentId: string
  retentionDays?: number
  keyKind?: 'public' | 'secret'
  keyLocation?: 'header' | 'query'
  allowedOrigin?: string | null
}

export type AuthOutcome =
  | { ok: true; principal: IngestPrincipal }
  | { ok: false; code: BatchErrorCode; message: string; retryAfter?: number | null }

export type Authenticator = (request: Request) => AuthOutcome | Promise<AuthOutcome>

export type SinkContext = {
  request: Request
  receivedAt: number
}

export type BatchSink = (
  batch: ParsedBatch,
  principal: IngestPrincipal,
  context: SinkContext,
) => Promise<unknown> | undefined

export const DEFAULT_RATE_WINDOW_SECONDS = 60

export type IngestLimits = {
  rateLimiter: RateLimiter
  eventsPerWindow: number
  windowSeconds?: number
}

export type IngestDeps = {
  authenticate: Authenticator
  sink: BatchSink
  limits?: IngestLimits
  defer?: (work: Promise<unknown>) => void
  onError?: (error: unknown) => void
  now?: () => number
  body?: ReadBodyOptions
}

export const DENIED_WITHOUT_A_KEY_STORE: AuthOutcome = {
  ok: false,
  code: 'invalid_key',
  message: 'This deployment has no key store configured',
}

export function denyAll(): AuthOutcome {
  return DENIED_WITHOUT_A_KEY_STORE
}

type DeferFn = (work: Promise<unknown>) => void

function platformDefer(c: { executionCtx?: unknown }): DeferFn | undefined {
  let ctx: unknown
  try {
    ctx = c.executionCtx
  } catch {
    return undefined
  }
  const waitUntil = (ctx as { waitUntil?: unknown } | undefined)?.waitUntil
  return typeof waitUntil === 'function'
    ? (work) => (waitUntil as (work: Promise<unknown>) => void).call(ctx, work)
    : undefined
}

function report(deps: IngestDeps, error: unknown): void {
  try {
    deps.onError?.(error)
  } catch {
    return
  }
}

async function measure(
  deps: IngestDeps,
  environmentId: string,
  events: number,
): Promise<RateLimitResult | null> {
  const limits = deps.limits
  if (limits === undefined || events === 0) {
    return null
  }

  try {
    return await limits.rateLimiter.consume(
      environmentId,
      limits.eventsPerWindow,
      limits.windowSeconds ?? DEFAULT_RATE_WINDOW_SECONDS,
      events,
    )
  } catch (error) {
    report(deps, error)
    return null
  }
}

export function createIngestApp(deps: IngestDeps): Hono {
  const app = new Hono()

  const fail = (
    code: BatchErrorCode,
    message: string,
    retryAfter: number | null = null,
  ): Response => {
    const headers =
      retryAfter === null
        ? undefined
        : { 'retry-after': String(Math.max(0, Math.ceil(retryAfter))) }
    return Response.json(errorBody(code, message, retryAfter), {
      status: statusFor(code),
      headers,
    })
  }

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.options('/v1/logs', (c) =>
    c.body(null, 204, preflightHeadersFor(c.req.header('origin') ?? null)),
  )

  app.post('/v1/logs', async (c) => {
    const origin = c.req.header('origin') ?? null
    const refuse = (code: BatchErrorCode, message: string, retryAfter: number | null = null) =>
      withCors(fail(code, message, retryAfter), origin)

    const auth = await deps.authenticate(c.req.raw)
    if (!auth.ok) {
      return refuse(auth.code, auth.message, auth.retryAfter ?? null)
    }

    const body = await readBatchBody(c.req.raw, deps.body)
    if (!body.ok) {
      return refuse(body.code, body.message)
    }

    const parsed = parseBatch(body.value)
    if (!parsed.ok) {
      return refuse(parsed.code, parsed.message)
    }

    const verdict = await measure(deps, auth.principal.environmentId, parsed.batch.accepted.length)
    if (verdict !== null && !verdict.allowed) {
      return refuse(
        'rate_limited',
        'Too many events for this environment',
        verdict.retryAfterSeconds,
      )
    }

    const context: SinkContext = {
      request: c.req.raw,
      receivedAt: (deps.now ?? Date.now)(),
    }

    const written = (async () => {
      try {
        await deps.sink(parsed.batch, auth.principal, context)
      } catch (error) {
        report(deps, error)
      }
    })()

    const deferred = platformDefer(c) ?? deps.defer
    if (deferred) {
      deferred(written)
    } else {
      await written
    }

    return c.json(
      { accepted: parsed.batch.accepted.length, rejected: parsed.batch.rejected },
      202,
      corsHeadersFor(origin),
    )
  })

  app.notFound(() =>
    Response.json(errorBody('invalid_payload', 'No such endpoint'), { status: 404 }),
  )

  app.onError((error) => {
    report(deps, error)
    return Response.json(
      { error: { code: 'internal_error', message: 'Unexpected error', retryAfter: null } },
      { status: 500 },
    )
  })

  return app
}

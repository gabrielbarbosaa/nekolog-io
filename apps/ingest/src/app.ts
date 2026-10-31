import { type BatchErrorCode, type ParsedBatch, parseBatch } from '@internal/schema'
import { Hono } from 'hono'
import { type ReadBodyOptions, readBatchBody } from './body.ts'
import { errorBody, statusFor } from './errors.ts'

export type IngestPrincipal = {
  projectId: string
  environmentId: string
  retentionDays?: number
}

export type AuthOutcome =
  | { ok: true; principal: IngestPrincipal }
  | { ok: false; code: BatchErrorCode; message: string; retryAfter?: number | null }

export type Authenticator = (request: Request) => AuthOutcome | Promise<AuthOutcome>

export type BatchSink = (
  batch: ParsedBatch,
  principal: IngestPrincipal,
) => Promise<unknown> | undefined

export type IngestDeps = {
  authenticate: Authenticator
  sink: BatchSink
  defer?: (work: Promise<unknown>) => void
  onError?: (error: unknown) => void
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

function report(deps: IngestDeps, error: unknown): void {
  try {
    deps.onError?.(error)
  } catch {
    return
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

  app.post('/v1/logs', async (c) => {
    const auth = await deps.authenticate(c.req.raw)
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.retryAfter ?? null)
    }

    const body = await readBatchBody(c.req.raw, deps.body)
    if (!body.ok) {
      return fail(body.code, body.message)
    }

    const parsed = parseBatch(body.value)
    if (!parsed.ok) {
      return fail(parsed.code, parsed.message)
    }

    const written = (async () => {
      try {
        await deps.sink(parsed.batch, auth.principal)
      } catch (error) {
        report(deps, error)
      }
    })()

    if (deps.defer) {
      deps.defer(written)
    } else {
      await written
    }

    return c.json({ accepted: parsed.batch.accepted.length, rejected: parsed.batch.rejected }, 202)
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

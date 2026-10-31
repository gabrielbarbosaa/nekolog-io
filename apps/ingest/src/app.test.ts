import { MAX_BATCH_BYTES, MAX_EVENTS_PER_BATCH, type ParsedBatch } from '@internal/schema'
import { describe, expect, it, vi } from 'vitest'
import {
  type Authenticator,
  type AuthOutcome,
  createIngestApp,
  denyAll,
  type IngestDeps,
  type IngestPrincipal,
} from './app.ts'

const PRINCIPAL: IngestPrincipal = { projectId: 'p_1', environmentId: 'e_1' }

const allow: Authenticator = () => ({ ok: true, principal: PRINCIPAL })

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    sdk: { name: '@nekolog-io/node', version: '0.0.0' },
    resource: { service: 'checkout-api', runtime: 'node' },
    events: [{ timestamp: '2026-10-31T12:00:00.000Z', level: 'info', message: 'hello' }],
    ...overrides,
  }
}

function setup(overrides: Partial<IngestDeps> = {}) {
  const batches: Array<{ batch: ParsedBatch; principal: IngestPrincipal }> = []
  const onError = vi.fn()
  const deps: IngestDeps = {
    authenticate: allow,
    sink: (batch, principal) => {
      batches.push({ batch, principal })
    },
    onError,
    ...overrides,
  }
  return { app: createIngestApp(deps), batches, onError }
}

type Body = string | Uint8Array | ReadableStream<Uint8Array> | null

function post(body: Body, headers: Record<string, string> = {}): Request {
  return new Request('https://ingest.nekolog.io/v1/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    // biome-ignore lint/suspicious/noExplicitAny: duplex is required by Node for a stream body
    ...({ duplex: 'half' } as any),
  })
}

function json(value: unknown, headers: Record<string, string> = {}): Request {
  return post(JSON.stringify(value), headers)
}

async function gzipped(value: unknown): Promise<Uint8Array> {
  const stream = new Response(new TextEncoder().encode(JSON.stringify(value))).body
  if (stream === null) {
    throw new Error('no stream')
  }
  return new Uint8Array(
    await new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  )
}

describe('/health', () => {
  it('answers without touching anything downstream', async () => {
    const { app, batches } = setup({
      authenticate: () => {
        throw new Error('auth should not run for health')
      },
    })

    const response = await app.request('https://ingest.nekolog.io/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(batches).toEqual([])
  })
})

describe('authentication', () => {
  it('is decided before the body matters at all', async () => {
    const { app } = setup({ authenticate: denyAll })

    const oversized = await app.request(post('x'.repeat(MAX_BATCH_BYTES + 1)))
    const malformed = await app.request(post('not json'))
    const wrongType = await app.request(post('{}', { 'content-type': 'application/xml' }))

    expect([oversized.status, malformed.status, wrongType.status]).toEqual([401, 401, 401])
  })

  it('answers with the stable error shape', async () => {
    const { app } = setup({ authenticate: denyAll })

    const response = await app.request(json(envelope()))

    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_key',
        message: 'This deployment has no key store configured',
        retryAfter: null,
      },
    })
  })

  it.each([
    ['invalid_key', 401],
    ['secret_key_in_url', 401],
    ['origin_not_allowed', 403],
    ['rate_limited', 429],
    ['quota_exceeded', 429],
  ] as const)('maps %s to %i', async (code, status) => {
    const { app } = setup({ authenticate: () => ({ ok: false, code, message: 'no' }) })

    expect((await app.request(json(envelope()))).status).toBe(status)
  })

  it('passes a Retry-After through, in the header and in the body', async () => {
    const outcome: AuthOutcome = {
      ok: false,
      code: 'rate_limited',
      message: 'Slow down',
      retryAfter: 30,
    }
    const { app } = setup({ authenticate: () => outcome })

    const response = await app.request(json(envelope()))

    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.json()).toMatchObject({ error: { retryAfter: 30 } })
  })

  it('hands the principal to the sink', async () => {
    const { app, batches } = setup()

    await app.request(json(envelope()))

    expect(batches[0]?.principal).toEqual(PRINCIPAL)
  })
})

describe('the body it accepts', () => {
  it('takes application/json', async () => {
    const { app } = setup()

    expect((await app.request(json(envelope()))).status).toBe(202)
  })

  it('takes text/plain, which is all sendBeacon can send across origins', async () => {
    const { app } = setup()

    const response = await app.request(json(envelope(), { 'content-type': 'text/plain' }))

    expect(response.status).toBe(202)
  })

  it('takes a content type with a charset on it', async () => {
    const { app } = setup()

    const response = await app.request(
      json(envelope(), { 'content-type': 'application/json; charset=utf-8' }),
    )

    expect(response.status).toBe(202)
  })

  it.each(['application/x-www-form-urlencoded', 'multipart/form-data', 'application/xml'])(
    'refuses %s',
    async (type) => {
      const { app } = setup()

      const response = await app.request(json(envelope(), { 'content-type': type }))

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } })
    },
  )

  it('refuses an empty body', async () => {
    const { app } = setup()

    const response = await app.request(post(''))

    expect(response.status).toBe(400)
  })

  it('refuses text that is not JSON', async () => {
    const { app } = setup()

    const response = await app.request(post('not json at all'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } })
  })

  it('refuses bytes that are not UTF-8 rather than quietly rewriting them', async () => {
    const { app, batches } = setup()
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        envelope({
          events: [{ timestamp: '2026-10-31T12:00:00.000Z', level: 'info', message: 'A' }],
        }),
      ),
    )
    const corrupted = bytes.indexOf(0x41)
    expect(corrupted).toBeGreaterThan(0)
    bytes[corrupted] = 0xff

    const response = await app.request(post(bytes))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } })
    expect(batches).toEqual([])
  })

  it('refuses bytes that are neither UTF-8 nor JSON', async () => {
    const { app } = setup()

    expect((await app.request(post(new Uint8Array([0xff, 0xfe, 0xfd])))).status).toBe(400)
  })

  it('refuses a JSON array, because the envelope is an object', async () => {
    const { app } = setup()

    expect((await app.request(json([]))).status).toBe(400)
  })
})

describe('size limits', () => {
  it('refuses on a declared Content-Length over the limit, whatever the body says', async () => {
    const { app, batches } = setup()

    const response = await app.request(
      json(envelope(), { 'content-length': String(MAX_BATCH_BYTES + 1) }),
    )

    expect(response.status).toBe(413)
    expect(batches).toEqual([])
  })

  it('stops reading once past the limit instead of buffering whatever arrives', async () => {
    const chunk = new Uint8Array(64 * 1024)
    let produced = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1
        controller.enqueue(chunk)
      },
    })
    const { app } = setup()

    const response = await app.request(post(endless))

    expect(response.status).toBe(413)
    expect(produced).toBeGreaterThan(0)
    expect(produced * chunk.byteLength).toBeLessThan(MAX_BATCH_BYTES * 4)
  })

  it('refuses a body that goes over the limit while being read', async () => {
    const { app } = setup()
    const oversized = JSON.stringify(
      envelope({
        events: [
          {
            timestamp: '2026-10-31T12:00:00.000Z',
            level: 'info',
            message: 'x'.repeat(MAX_BATCH_BYTES),
          },
        ],
      }),
    )

    const response = await app.request(post(oversized))

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } })
  })

  it('refuses a small gzip that expands past the limit', async () => {
    const bomb = new Uint8Array(
      await new Response(
        new Response(new Uint8Array(MAX_BATCH_BYTES * 4)).body?.pipeThrough(
          new CompressionStream('gzip'),
        ),
      ).arrayBuffer(),
    )
    const { app } = setup()

    expect(bomb.byteLength).toBeLessThan(4096)

    const response = await app.request(post(bomb, { 'content-encoding': 'gzip' }))

    expect(response.status).toBe(413)
  })

  it('takes a gzip that stays inside the limit', async () => {
    const { app, batches } = setup()
    const body = await gzipped(envelope())

    const response = await app.request(post(body, { 'content-encoding': 'gzip' }))

    expect(response.status).toBe(202)
    expect(batches[0]?.batch.accepted).toHaveLength(1)
  })

  it('refuses a body that claims to be gzip and is not', async () => {
    const { app } = setup()

    const response = await app.request(json(envelope(), { 'content-encoding': 'gzip' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } })
  })
})

describe('the batch it validates', () => {
  it('answers 202 with the counts', async () => {
    const { app } = setup()

    const response = await app.request(json(envelope()))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: 1, rejected: [] })
  })

  it('keeps the good events and reports the bad ones by index', async () => {
    const { app, batches } = setup()
    const body = envelope({
      events: [
        { timestamp: '2026-10-31T12:00:00.000Z', level: 'info', message: 'kept' },
        { timestamp: '2026-10-31T12:00:00.000Z', level: 'verbose', message: 'bad level' },
        { timestamp: 'yesterday', level: 'info', message: 'bad timestamp' },
      ],
    })

    const response = await app.request(json(body))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      accepted: 1,
      rejected: [
        { index: 1, code: 'invalid_level' },
        { index: 2, code: 'invalid_timestamp' },
      ],
    })
    expect(batches[0]?.batch.accepted[0]?.event.message).toBe('kept')
  })

  it('refuses a schema version it does not know', async () => {
    const { app } = setup()

    const response = await app.request(json(envelope({ schemaVersion: 99 })))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'unsupported_schema_version' },
    })
  })

  it('refuses an envelope missing its batchId', async () => {
    const { app } = setup()
    const body = envelope()
    delete (body as Record<string, unknown>).batchId

    const response = await app.request(json(body))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } })
  })

  it('refuses more events than the contract allows', async () => {
    const { app } = setup()
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ({
      timestamp: '2026-10-31T12:00:00.000Z',
      level: 'info',
      message: 'x',
    }))

    const response = await app.request(json(envelope({ events })))

    expect(response.status).toBe(400)
  })

  it('refuses an empty event list', async () => {
    const { app } = setup()

    expect((await app.request(json(envelope({ events: [] })))).status).toBe(400)
  })
})

describe('handing the batch on', () => {
  it('gives the sink the parsed batch, not the raw body', async () => {
    const { app, batches } = setup()

    await app.request(json(envelope()))

    expect(batches[0]?.batch.batchId).toBe('01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10')
    expect(batches[0]?.batch.resource.service).toBe('checkout-api')
  })

  it('still answers 202 when the sink throws, and says so through onError', async () => {
    const boom = new Error('clickhouse is down')
    const { app, onError } = setup({
      sink: () => {
        throw boom
      },
    })

    const response = await app.request(json(envelope()))

    expect(response.status).toBe(202)
    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('answers before a deferred write finishes', async () => {
    const deferred: Array<Promise<unknown>> = []
    let released = (): void => undefined
    const { app } = setup({
      defer: (work) => deferred.push(work),
      sink: () =>
        new Promise<void>((resolve) => {
          released = () => resolve()
        }),
    })

    const response = await app.request(json(envelope()))

    expect(response.status).toBe(202)
    expect(deferred).toHaveLength(1)
    released()
    await deferred[0]
  })

  it('waits for the write when there is nowhere to defer it', async () => {
    let finished = false
    const { app } = setup({
      sink: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        finished = true
      },
    })

    await app.request(json(envelope()))

    expect(finished).toBe(true)
  })
})

describe('everything else', () => {
  it('answers 404 in the same shape', async () => {
    const { app } = setup()

    const response = await app.request('https://ingest.nekolog.io/nope')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } })
  })

  it('does not accept GET on the ingest route', async () => {
    const { app } = setup()

    const response = await app.request('https://ingest.nekolog.io/v1/logs')

    expect(response.status).toBe(404)
  })

  it('does not leak the error when something unexpected throws', async () => {
    const boom = new Error('secret internal detail nekolog_sk_abc')
    const { app, onError } = setup({
      authenticate: () => {
        throw boom
      },
    })

    const response = await app.request(json(envelope()))
    const text = await response.text()

    expect(response.status).toBe(500)
    expect(text).not.toContain('nekolog_sk_abc')
    expect(text).not.toContain('secret internal detail')
    expect(onError).toHaveBeenCalledWith(boom)
  })
})

import type { ParsedBatch } from '@internal/schema'
import { describe, expect, it, vi } from 'vitest'
import {
  type Authenticator,
  createIngestApp,
  denyAll,
  type IngestDeps,
  type IngestPrincipal,
  partialSuccessFor,
} from './app.ts'
import { MAX_OTLP_RECORDS } from './otlp.ts'

const PRINCIPAL: IngestPrincipal = { projectId: 'p_1', environmentId: 'e_1' }
const allow: Authenticator = () => ({ ok: true, principal: PRINCIPAL })

const BATCH_ID = '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10'
const AT = Date.UTC(2026, 10, 4, 12, 0, 0)
const NANOS = String(BigInt(AT) * 1000000n)

function setup(overrides: Partial<IngestDeps> = {}) {
  const batches: Array<{ batch: ParsedBatch; principal: IngestPrincipal }> = []
  const onError = vi.fn()
  const deps: IngestDeps = {
    authenticate: allow,
    sink: (batch, principal) => {
      batches.push({ batch, principal })
    },
    onError,
    now: () => AT,
    newBatchId: () => BATCH_ID,
    ...overrides,
  }
  return { app: createIngestApp(deps), batches, onError }
}

function otlp(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://ingest.nekolog.io/v1/otlp/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function records(count: number) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'checkout-api' } }],
        },
        scopeLogs: [
          {
            logRecords: Array.from({ length: count }, (_, at) => ({
              timeUnixNano: NANOS,
              severityNumber: 9,
              body: { stringValue: `line ${at}` },
            })),
          },
        ],
      },
    ],
  }
}

describe('the partial success body', () => {
  it('is empty when everything was taken, as the specification says', () => {
    expect(partialSuccessFor(0)).toEqual({})
  })

  it('counts what was refused, as a string', () => {
    expect(partialSuccessFor(3)).toMatchObject({ rejectedLogRecords: '3' })
  })
})

describe('POST /v1/otlp/logs', () => {
  it('answers 200, not 202, because that is what an OTLP client expects', async () => {
    const { app, batches } = setup()

    const response = await app.fetch(otlp(records(1)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ partialSuccess: {} })
    expect(batches).toHaveLength(1)
  })

  it('writes the records through the same sink as a native batch', async () => {
    const { app, batches } = setup()

    await app.fetch(otlp(records(3)))

    expect(batches[0]?.batch.accepted).toHaveLength(3)
    expect(batches[0]?.batch.resource.service).toBe('checkout-api')
    expect(batches[0]?.principal).toBe(PRINCIPAL)
  })

  it('refuses a key the authenticator rejects, before reading the body', async () => {
    let read = false
    const { app, batches } = setup({
      authenticate: denyAll,
      sink: () => {
        read = true
      },
    })

    const response = await app.fetch(otlp(records(1)))

    expect(response.status).toBe(401)
    expect(batches).toEqual([])
    expect(read).toBe(false)
  })

  it('counts the records it could not read in the partial success', async () => {
    const { app } = setup()

    const response = await app.fetch(
      otlp({
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: [
                  { timeUnixNano: NANOS, body: { stringValue: 'kept' } },
                  { timeUnixNano: NANOS, body: {} },
                ],
              },
            ],
          },
        ],
      }),
    )

    expect(await response.json()).toEqual({
      partialSuccess: {
        rejectedLogRecords: '1',
        errorMessage: '1 log record(s) were not accepted',
      },
    })
  })

  it('takes an empty request as nothing to do, and writes nothing', async () => {
    const { app, batches } = setup()

    const response = await app.fetch(otlp({ resourceLogs: [] }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ partialSuccess: {} })
    expect(batches).toEqual([])
  })

  it('refuses a body that is not OTLP at all', async () => {
    const { app, batches } = setup()

    const response = await app.fetch(otlp({ records: [] }))

    expect(response.status).toBe(400)
    expect(batches).toEqual([])
  })

  it('answers 429 when the environment is over its quota, like the native route', async () => {
    const { app, batches } = setup({
      limits: {
        eventsPerWindow: 1,
        rateLimiter: {
          async consume() {
            return { allowed: false, remaining: 0, retryAfterSeconds: 30 }
          },
        },
      },
    })

    const response = await app.fetch(otlp(records(1)))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(batches).toEqual([])
  })

  it('mints a batch id of its own, because OTLP carries none', async () => {
    const { app, batches } = setup({ newBatchId: undefined })

    await app.fetch(otlp(records(1)))

    expect(batches[0]?.batch.batchId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('stops at the batch limit instead of refusing the whole request', async () => {
    const { app, batches } = setup()

    const response = await app.fetch(otlp(records(MAX_OTLP_RECORDS + 5)))

    expect(response.status).toBe(200)
    expect(batches[0]?.batch.accepted).toHaveLength(MAX_OTLP_RECORDS)
    expect(await response.json()).toMatchObject({
      partialSuccess: { rejectedLogRecords: '5' },
    })
  })

  it('takes gzip, like the native route', async () => {
    const { app, batches } = setup()
    const stream = new Response(new TextEncoder().encode(JSON.stringify(records(2)))).body
    if (stream === null) {
      throw new Error('no stream')
    }
    const compressed = new Uint8Array(
      await new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
    )

    const response = await app.fetch(
      new Request('https://ingest.nekolog.io/v1/otlp/logs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        body: compressed,
      }),
    )

    expect(response.status).toBe(200)
    expect(batches[0]?.batch.accepted).toHaveLength(2)
  })

  it('answers the same 200 whether the write succeeded or not, and reports the failure', async () => {
    const { app, onError } = setup({
      sink: () => {
        throw new Error('ClickHouse is down')
      },
    })

    const response = await app.fetch(otlp(records(1)))

    expect(response.status).toBe(200)
    expect(onError).toHaveBeenCalled()
  })
})

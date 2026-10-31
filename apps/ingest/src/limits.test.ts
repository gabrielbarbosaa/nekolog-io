import { memoryRateLimiter, type RateLimiter } from '@internal/adapters'
import type { ParsedBatch } from '@internal/schema'
import { describe, expect, it, vi } from 'vitest'
import {
  type Authenticator,
  createIngestApp,
  type IngestDeps,
  type IngestPrincipal,
} from './app.ts'

const PRINCIPAL: IngestPrincipal = { projectId: 'p_1', environmentId: 'e_1' }

const allow: Authenticator = () => ({ ok: true, principal: PRINCIPAL })

function events(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: '2026-10-31T12:00:00.000Z',
    level: 'info',
    message: `hello ${index}`,
  }))
}

function envelope(count: number, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    sdk: { name: '@nekolog-io/node', version: '0.0.0' },
    resource: { service: 'checkout-api', runtime: 'node' },
    events: events(count),
    ...overrides,
  }
}

function setup(overrides: Partial<IngestDeps> = {}) {
  const batches: Array<{ batch: ParsedBatch; principal: IngestPrincipal }> = []
  const onError = vi.fn()
  const app = createIngestApp({
    authenticate: allow,
    sink: (batch, principal) => {
      batches.push({ batch, principal })
    },
    onError,
    ...overrides,
  })
  return { app, batches, onError }
}

function send(app: ReturnType<typeof setup>['app'], body: unknown) {
  return app.request(
    new Request('https://ingest.nekolog.io/v1/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.test' },
      body: JSON.stringify(body),
    }),
  )
}

describe('the rate limit', () => {
  it('lets a batch through while the environment still has budget', async () => {
    const { app, batches } = setup({
      limits: { rateLimiter: memoryRateLimiter(), eventsPerWindow: 10 },
    })

    expect((await send(app, envelope(4))).status).toBe(202)
    expect(batches).toHaveLength(1)
  })

  it('charges the events in the batch, not one per request', async () => {
    const { app } = setup({
      limits: { rateLimiter: memoryRateLimiter(), eventsPerWindow: 10 },
    })

    expect((await send(app, envelope(6))).status).toBe(202)
    expect((await send(app, envelope(4))).status).toBe(202)
    expect((await send(app, envelope(1))).status).toBe(429)
  })

  it('answers 429 with a stable code and a Retry-After the SDK can honour', async () => {
    const { app } = setup({
      limits: { rateLimiter: memoryRateLimiter(), eventsPerWindow: 1, windowSeconds: 60 },
    })

    await send(app, envelope(1))
    const response = await send(app, envelope(1))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many events for this environment',
        retryAfter: 60,
      },
    })
  })

  it('keeps the refused batch away from the sink', async () => {
    const { app, batches } = setup({
      limits: { rateLimiter: memoryRateLimiter(), eventsPerWindow: 1 },
    })

    await send(app, envelope(1))
    await send(app, envelope(1))

    expect(batches).toHaveLength(1)
  })

  it('still answers a refusal the browser can read', async () => {
    const { app } = setup({
      limits: { rateLimiter: memoryRateLimiter(), eventsPerWindow: 1 },
    })

    await send(app, envelope(1))
    const response = await send(app, envelope(1))

    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.test')
  })

  it('counts each environment on its own', async () => {
    let environmentId = 'e_1'
    const { app } = setup({
      authenticate: () => ({ ok: true, principal: { projectId: 'p_1', environmentId } }),
      limits: { rateLimiter: memoryRateLimiter(), eventsPerWindow: 1 },
    })

    expect((await send(app, envelope(1))).status).toBe(202)
    expect((await send(app, envelope(1))).status).toBe(429)

    environmentId = 'e_2'
    expect((await send(app, envelope(1))).status).toBe(202)
  })

  it('spends nothing on a batch that had no acceptable event', async () => {
    const limiter = memoryRateLimiter()
    const consume = vi.spyOn(limiter, 'consume')
    const { app } = setup({ limits: { rateLimiter: limiter, eventsPerWindow: 10 } })

    const response = await send(app, envelope(1, { events: [{ level: 'nope' }] }))

    expect(response.status).toBe(202)
    expect(consume).not.toHaveBeenCalled()
  })

  it('does not count the events it refused inside an accepted batch', async () => {
    const limiter = memoryRateLimiter()
    const consume = vi.spyOn(limiter, 'consume')
    const { app } = setup({ limits: { rateLimiter: limiter, eventsPerWindow: 10 } })

    await send(app, envelope(1, { events: [...events(2), { level: 'nope' }] }))

    expect(consume).toHaveBeenCalledWith('e_1', 10, 60, 2)
  })

  it('keeps ingesting when the limiter itself breaks, and says so', async () => {
    const broken: RateLimiter = {
      async consume() {
        throw new Error('the limiter is unreachable')
      },
    }
    const { app, batches, onError } = setup({
      limits: { rateLimiter: broken, eventsPerWindow: 1 },
    })

    expect((await send(app, envelope(1))).status).toBe(202)
    expect(batches).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('ingests normally when no limiter is configured at all', async () => {
    const { app } = setup()

    expect((await send(app, envelope(500))).status).toBe(202)
  })
})

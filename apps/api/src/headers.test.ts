import { memoryRateLimiter } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import { API_HEADERS, type ApiDeps, createApiApp } from './app.ts'
import type { ApiPrincipal } from './authenticate.ts'

const PRINCIPAL: ApiPrincipal = { projectId: 'prj_1', environmentId: 'env_1' }

function app(over: Partial<ApiDeps> = {}) {
  return createApiApp({
    authenticate: (request) =>
      request.headers.has('authorization')
        ? { ok: true, principal: PRINCIPAL }
        : { ok: false, code: 'invalid_key', message: 'No key' },
    query: async () => [],
    database: 'nekolog_dev',
    ...over,
  })
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.nekolog.io${path}`, {
    headers: { authorization: 'Bearer nekolog_sk_x', ...headers },
  })
}

describe('the headers every answer carries', () => {
  it('refuses to be sniffed as anything but what it says it is', async () => {
    const response = await app().request(get('/v1/logs?limit=10'))

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('is never stored by anything between here and the caller', async () => {
    const response = await app().request(get('/v1/logs?limit=10'))

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('cannot be loaded as a subresource by another site', async () => {
    const response = await app().request(get('/v1/logs?limit=10'))

    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })

  it('asks for HTTPS next time', async () => {
    const response = await app().request(get('/v1/logs?limit=10'))

    expect(response.headers.get('strict-transport-security')).toMatch(/max-age=\d+/)
  })

  it('carries them on a refusal too, which is where a body is least expected', async () => {
    const refused = await app().request(new Request('https://api.nekolog.io/v1/logs'))
    const missing = await app().request(get('/nope'))
    const rejected = await app().request(get('/v1/logs?period=99y'))

    for (const response of [refused, missing, rejected]) {
      expect(response.status, String(response.status)).toBeGreaterThanOrEqual(400)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('carries them when the upstream fell over', async () => {
    const broken = app({
      query: async () => {
        throw new Error('clickhouse is down')
      },
      onError: () => undefined,
    })
    const response = await broken.request(get('/v1/logs?limit=10'))

    expect(response.status).toBe(503)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('carries them on a rate limited answer', async () => {
    const limited = app({ limits: { rateLimiter: memoryRateLimiter(), requestsPerWindow: 1 } })
    await limited.request(get('/v1/logs?limit=10'))
    const response = await limited.request(get('/v1/logs?limit=10'))

    expect(response.status).toBe(429)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('carries them on /health and on the OpenAPI, which anybody can fetch', async () => {
    const served = app({ openapi: () => ({ openapi: '3.1.0' }) })

    for (const path of ['/health', '/openapi.json']) {
      const response = await served.request(new Request(`https://api.nekolog.io${path}`))
      expect(response.status, path).toBe(200)
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff')
    }
  })

  it('names every header exactly once, so nothing is set in two places', () => {
    expect(Object.keys(API_HEADERS).sort()).toEqual([
      'Cache-Control',
      'Cross-Origin-Resource-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
    ])
  })
})

describe('a parameter this route does not have', () => {
  it('is refused, instead of being ignored while the caller believes it worked', async () => {
    const response = await app().request(get('/v1/logs?period=7d'))
    const body = (await response.json()) as { error: { code: string; message: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('invalid_query')
    expect(body.error.message).toContain('period')
    expect(body.error.message).toContain('from')
  })

  it('is refused on every route, each naming its own parameters', async () => {
    const served = app({ issues: { list: async () => ({ issues: [], nextCursor: null }) } })

    for (const [path, named] of [
      ['/v1/logs?nope=1', 'order'],
      ['/v1/histogram?nope=1', 'bucket'],
      ['/v1/issues?nope=1', 'cursor'],
    ] as const) {
      const response = await served.request(get(path))
      const body = (await response.json()) as { error: { message: string } }

      expect(response.status, path).toBe(400)
      expect(body.error.message, path).toContain(named)
    }
  })

  it('takes every parameter the route really has', async () => {
    const served = app({ issues: { list: async () => ({ issues: [], nextCursor: null }) } })

    for (const path of [
      '/v1/logs?from=2026-11-04T10:00:00Z&to=2026-11-04T11:00:00Z&limit=10&order=oldest&q=level%3Aerror',
      '/v1/histogram?from=2026-11-04T10:00:00Z&to=2026-11-04T11:00:00Z&bucket=15m&q=',
      '/v1/issues?limit=10&status=open&cursor=&since=2026-11-01T00:00:00Z&until=2026-11-04T00:00:00Z',
    ]) {
      const response = await served.request(get(path))
      expect(response.status, path).toBe(200)
    }
  })

  it('still refuses a key in the URL first, which is a worse mistake than a typo', async () => {
    const response = await app({
      authenticate: () => ({ ok: false, code: 'secret_key_in_url', message: 'Key in the URL' }),
    }).request(get('/v1/logs?key=nekolog_sk_x&nope=1'))
    const body = (await response.json()) as { error: { code: string } }

    expect(body.error.code).toBe('secret_key_in_url')
  })
})

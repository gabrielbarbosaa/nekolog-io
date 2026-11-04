import { describe, expect, it } from 'vitest'
import {
  type Authenticator,
  createIngestApp,
  INGEST_HEADERS,
  type IngestDeps,
  type IngestPrincipal,
} from './app.ts'

const PRINCIPAL: IngestPrincipal = { projectId: 'prj_1', environmentId: 'env_1' }

const allow: Authenticator = (request) =>
  request.headers.has('authorization')
    ? { ok: true, principal: PRINCIPAL }
    : { ok: false, code: 'invalid_key', message: 'No key' }

function app(over: Partial<IngestDeps> = {}) {
  return createIngestApp({ authenticate: allow, sink: () => undefined, ...over })
}

const BATCH = {
  schemaVersion: 1,
  batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
  sdk: { name: '@nekolog-io/node', version: '1.0.0' },
  resource: { service: 'checkout-api', runtime: 'node' },
  events: [{ timestamp: '2026-11-04T12:00:00.000Z', level: 'info', message: 'hello' }],
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://ingest.nekolog.io/v1/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer k', ...headers },
    body: JSON.stringify(body),
  })
}

describe('the headers the ingestion carries', () => {
  it('refuses to be sniffed, and is never stored on the way back', async () => {
    const response = await app().request(post(BATCH))

    expect(response.status).toBe(202)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('strict-transport-security')).toMatch(/max-age=\d+/)
  })

  it('carries them on every refusal, and on the 404 and the 500', async () => {
    const refused = await app().request(
      new Request('https://ingest.nekolog.io/v1/logs', { method: 'POST', body: '{}' }),
    )
    const invalid = await app().request(post({ schemaVersion: 1 }))
    const missing = await app().request(new Request('https://ingest.nekolog.io/nope'))
    const broken = await app({
      authenticate: () => {
        throw new Error('the key store fell over')
      },
      onError: () => undefined,
    }).request(post(BATCH))

    for (const response of [refused, invalid, missing, broken]) {
      expect(response.status, String(response.status)).toBeGreaterThanOrEqual(400)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('carries them on the CORS preflight and on /health', async () => {
    const preflight = await app().request(
      new Request('https://ingest.nekolog.io/v1/logs', {
        method: 'OPTIONS',
        headers: { origin: 'https://shop.example.com' },
      }),
    )
    const health = await app().request(new Request('https://ingest.nekolog.io/health'))

    for (const response of [preflight, health]) {
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    }
  })

  it('never sends Cross-Origin-Resource-Policy, which is the one deliberate exception', async () => {
    const answers = [
      await app().request(post(BATCH)),
      await app().request(new Request('https://ingest.nekolog.io/health')),
      await app().request(new Request('https://ingest.nekolog.io/nope')),
    ]

    for (const response of answers) {
      expect(response.headers.get('cross-origin-resource-policy')).toBeNull()
    }
    expect(Object.keys(INGEST_HEADERS)).not.toContain('Cross-Origin-Resource-Policy')
  })

  it('leaves the CORS headers the browser SDK needs alone', async () => {
    const response = await app().request(post(BATCH, { origin: 'https://shop.example.com' }))

    expect(response.status).toBe(202)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.has('access-control-allow-origin')).toBe(true)
  })

  it('names exactly the three headers it means to send', () => {
    expect(Object.keys(INGEST_HEADERS).sort()).toEqual([
      'Cache-Control',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
    ])
  })
})
